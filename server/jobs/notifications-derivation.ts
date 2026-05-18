import { db, withDbAdvisoryLock } from "../db";
import {
  marketBets,
  notificationMarketMutes,
  notifications,
  predictionMarkets,
  profiles,
  trackedPeople,
  trendSnapshots,
  trendingPeople,
  userFavourites,
} from "@shared/schema";
import { and, desc, eq, gte, inArray, isNull, lte, lt, sql } from "drizzle-orm";
import { log } from "../log";
import { createNotification } from "../services/notifications";
import { loadAmmPositionsFor } from "../services/amm-positions";
import {
  buildPositionMoveNotification,
  evaluatePositionMove,
  POSITION_MOVE_MIN_NOTIONAL_DEFAULT,
  POSITION_MOVE_PCT_THRESHOLD_DEFAULT,
} from "./position-move-notification";
import {
  formatWeeklyDigestBody,
  isoYearWeek,
  isWeeklyDigestFireWindow,
  WEEKLY_DIGEST_TITLE,
  type WeeklyDigestStats,
} from "./weekly-digest-utils";
import { formatResolutionImminentNotification } from "./resolution-imminent-utils";
import { STREAK_MILESTONES } from "@shared/streak-config";

/**
 * Derivation jobs for in-app notifications.
 *
 * These run on a schedule and detect "passive" events that don't have a
 * single triggering action — rank crossings, big trend moves, markets
 * about to close, streaks at risk. Synchronous fanout (in routes.ts and
 * services/gamification.ts) covers the immediate user-action kinds.
 *
 * Idempotency: every notification we emit here uses a stable key built
 * from a deterministic time bucket (snapshotHour, dayBucket, etc.) so
 * re-running the job in the same window absorbs into the unique
 * (user_id, idempotency_key) constraint.
 *
 * Scheduling: the entry point is `runNotificationsDerivation()`. It
 * acquires an advisory lock so multiple Node processes (or a stuck-then-
 * woken up tick) can't fan out duplicate notifications.
 */

const DERIVATION_LOCK_KEY = 5_207;

// Lookahead window for the closing-soon scanner. Markets whose close
// lies inside this window are considered for milestone gating below;
// markets further out are ignored until they drift into range. Was 6h
// (single uniform reminder); 24h gives the 24h milestone room to fire.
const MARKET_CLOSING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;
const MARKET_CLOSING_SOON_GRACE_MS = 30 * 60 * 1000;

// Closing-soon milestones, ordered largest threshold → smallest.
// Each milestone fires at most once per (user, variant, close-cycle)
// via the idempotency key downstream; inside a milestone bucket the
// row content (time-remaining label, market count) refreshes silently
// via `refreshOnConflict` on every cron tick.
//
// Why these four? They map to the lead times people actually act on:
//   24h — "I'll get to it tonight"
//    4h — "I'll grab a coffee and decide"
//    1h — "ok, this is real, last review"
//    5m — "now or never"
// Anything denser than this was the original symptom report — the
// UTC-hour key was creating 1m/1h/2h/3h/… stacks per market per user.
const CLOSING_MILESTONES = [
  { id: "24h", thresholdMs: 24 * 60 * 60 * 1000 },
  { id: "4h", thresholdMs: 4 * 60 * 60 * 1000 },
  { id: "1h", thresholdMs: 1 * 60 * 60 * 1000 },
  { id: "5m", thresholdMs: 5 * 60 * 1000 },
] as const;

type ClosingMilestoneId = (typeof CLOSING_MILESTONES)[number]["id"];

/**
 * Smallest milestone whose `thresholdMs` is ≥ the remaining time. Returns
 * `null` when the market is further out than the largest milestone (e.g.
 * a 48h-out market on a 24h schedule) or has already closed (negative
 * value — let the auto-dismiss cleanup pass handle stale rows).
 *
 * Worked examples on the default 24h/4h/1h/5m schedule:
 *   ~30h until close → null (too far out)
 *   ~12h until close → "24h"   (still inside the 24h bucket)
 *    ~3h until close → "4h"
 *   ~30m until close → "1h"
 *    ~3m until close → "5m"
 *      already closed → null (no fresh fire; cleanup handles)
 */
function currentMilestone(timeUntilCloseMs: number): ClosingMilestoneId | null {
  if (timeUntilCloseMs <= 0) return null;
  // CLOSING_MILESTONES is ordered largest→smallest. The smallest
  // milestone whose threshold still covers `timeUntilCloseMs` is the
  // last one we see before crossing below; once a threshold dips under
  // we can stop walking. (Tiny list so the optimization is cosmetic —
  // the break exists to make "we land in the deepest qualifying
  // bucket" obvious to readers.)
  let chosen: ClosingMilestoneId | null = null;
  for (const m of CLOSING_MILESTONES) {
    if (m.thresholdMs < timeUntilCloseMs) break;
    chosen = m.id;
  }
  return chosen;
}

// Hot mover threshold mirrors the trending-people "hot mover" pill in
// the favorites dashboard — exceptional 24h move, not garden-variety.
const HOT_MOVER_PCT_THRESHOLD = 15;
const HOT_MOVER_ROLLING_COOLDOWN_HOURS = 24;

/**
 * Returns a stable hour-bucket key (UTC) for idempotency. The actual
 * job interval is 10 min but we bucket on hour so the same crossing
 * detected at :10 and :20 doesn't fire twice.
 */
function hourBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13); // "2026-05-01T19"
}

function dayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10); // "2026-05-01"
}

/**
 * Detect favorites who have crossed Top 10 / Top 50 / out of Top 100
 * since 24h ago. Reuses the snapshot-comparison pattern that already
 * exists in the favorites dashboard route, but writes notifications
 * instead of computing on read.
 */
async function deriveFavoriteRankCrossings(): Promise<number> {
  // Pull every (user, favorite_person) tuple. For platforms with millions
  // of favorites this would need batching; VoxDex's favorite count is
  // bounded and small, so a single query is fine.
  const favs = await db
    .select({
      userId: userFavourites.userId,
      personId: userFavourites.personId,
    })
    .from(userFavourites);

  if (favs.length === 0) return 0;

  const personIds = Array.from(new Set(favs.map((f) => f.personId)));

  const [trendingRows, snapshot24hRows, peopleRows] = await Promise.all([
    db
      .select({ id: trendingPeople.id, name: trendingPeople.name, rank: trendingPeople.rank })
      .from(trendingPeople)
      .where(inArray(trendingPeople.id, personIds)),
    db
      .select({
        personId: trendSnapshots.personId,
        timestamp: trendSnapshots.timestamp,
        diagnostics: trendSnapshots.diagnostics,
      })
      .from(trendSnapshots)
      .where(
        and(
          inArray(trendSnapshots.personId, personIds),
          gte(trendSnapshots.timestamp, sql`NOW() - INTERVAL '28 hours'`),
          lte(trendSnapshots.timestamp, sql`NOW() - INTERVAL '20 hours'`),
          eq(trendSnapshots.snapshotOrigin, "ingest"),
        ),
      )
      .orderBy(desc(trendSnapshots.timestamp)),
    db
      .select({ id: trackedPeople.id, name: trackedPeople.name })
      .from(trackedPeople)
      .where(inArray(trackedPeople.id, personIds)),
  ]);

  const personNameMap = new Map(peopleRows.map((p) => [p.id, p.name]));
  const currentRankMap = new Map(trendingRows.map((p) => [p.id, p.rank]));

  // Most-recent prior snapshot per person. The dashboard route does the
  // same de-dupe (first row wins because we ordered desc by timestamp).
  const priorRankByPerson = new Map<string, number>();
  for (const s of snapshot24hRows) {
    if (priorRankByPerson.has(s.personId)) continue;
    const diag = s.diagnostics as { rank?: number; rankPrior?: number } | null;
    const priorRank = diag?.rank ?? diag?.rankPrior;
    if (typeof priorRank === "number") {
      priorRankByPerson.set(s.personId, priorRank);
    }
  }

  const bucket = hourBucket();
  let inserted = 0;

  for (const fav of favs) {
    const prior = priorRankByPerson.get(fav.personId);
    const current = currentRankMap.get(fav.personId);
    if (typeof prior !== "number" || typeof current !== "number") continue;

    let crossing: "top10" | "top50" | "out_top100" | null = null;
    let title = "";
    if (prior > 10 && current <= 10) {
      crossing = "top10";
      title = `${personNameMap.get(fav.personId) ?? "Your favorite"} broke into the Top 10`;
    } else if (prior > 50 && current <= 50) {
      crossing = "top50";
      title = `${personNameMap.get(fav.personId) ?? "Your favorite"} is now Top 50`;
    } else if (prior <= 100 && current > 100) {
      crossing = "out_top100";
      title = `${personNameMap.get(fav.personId) ?? "Your favorite"} dropped out of the Top 100`;
    }
    if (!crossing) continue;

    const id = await createNotification({
      userId: fav.userId,
      kind: "favorite_rank_cross",
      title,
      body: `Now ranked #${current} (was #${prior}).`,
      href: `/person/${fav.personId}`,
      entityType: "person",
      entityId: fav.personId,
      metadata: { crossing, previousRank: prior, currentRank: current },
      // Audit: idempotencyKey already includes the UTC hour bucket so
      // we cannot exceed one row per (user, person, crossing) per hour.
      // groupKey here collapses any yo-yo crossings client-side — e.g.
      // a person who breaks top10 then re-crosses 14h later shows as
      // one row with "+1 earlier" instead of two separate rows. Scoped
      // to (user, person) — not (user, person, crossing) — so that a
      // single person's mixed crossings (top10 → top50 → top10) also
      // fold together, which is what users actually mean by "show me
      // what changed about this person."
      groupKey: `favorite_rank_cross:${fav.userId}:${fav.personId}`,
      idempotencyKey: `favrank:${fav.userId}:${fav.personId}:${crossing}:${bucket}`,
    });
    if (id) inserted += 1;
  }

  return inserted;
}

/**
 * Detect favorites with an exceptional 24h trend-score move. Throttled
 * to once per (user, person) per UTC day via the dayBucket idempotency
 * key, and gated by a percentage threshold so this stays "rare and
 * meaningful" rather than ambient noise.
 */
async function deriveFavoriteHotMovers(): Promise<number> {
  const favs = await db
    .select({
      userId: userFavourites.userId,
      personId: userFavourites.personId,
    })
    .from(userFavourites);

  if (favs.length === 0) return 0;

  const personIds = Array.from(new Set(favs.map((f) => f.personId)));

  const [currentRows, snapshot24hRows, peopleRows] = await Promise.all([
    db
      .select({ id: trendingPeople.id, name: trendingPeople.name, fameIndex: trendingPeople.fameIndex })
      .from(trendingPeople)
      .where(inArray(trendingPeople.id, personIds)),
    db
      .select({
        personId: trendSnapshots.personId,
        timestamp: trendSnapshots.timestamp,
        fameIndex: trendSnapshots.fameIndex,
      })
      .from(trendSnapshots)
      .where(
        and(
          inArray(trendSnapshots.personId, personIds),
          gte(trendSnapshots.timestamp, sql`NOW() - INTERVAL '28 hours'`),
          lte(trendSnapshots.timestamp, sql`NOW() - INTERVAL '20 hours'`),
          eq(trendSnapshots.snapshotOrigin, "ingest"),
        ),
      )
      .orderBy(desc(trendSnapshots.timestamp)),
    db
      .select({ id: trackedPeople.id, name: trackedPeople.name })
      .from(trackedPeople)
      .where(inArray(trackedPeople.id, personIds)),
  ]);

  const personNameMap = new Map(peopleRows.map((p) => [p.id, p.name]));
  const currentScoreMap = new Map(currentRows.map((r) => [r.id, r.fameIndex ?? null]));
  const priorScoreMap = new Map<string, number>();
  for (const s of snapshot24hRows) {
    if (priorScoreMap.has(s.personId)) continue;
    if (typeof s.fameIndex === "number") {
      priorScoreMap.set(s.personId, s.fameIndex);
    }
  }

  const bucket = dayBucket();
  // Build the interval via `make_interval` so the cooldown hours can
  // ride in as a real query parameter. The previous form,
  // `INTERVAL '${HOT_MOVER_ROLLING_COOLDOWN_HOURS} hours'`, expanded
  // the variable as a parameter *inside* a string literal — Postgres
  // doesn't substitute `$N` inside quotes, so the query came out as
  // `INTERVAL '$5 hours'` and Postgres rejected it on every tick,
  // silently breaking favourite-hot-mover notifications.
  const cooldownSince = sql`NOW() - make_interval(hours => ${HOT_MOVER_ROLLING_COOLDOWN_HOURS})`;
  let inserted = 0;

  for (const fav of favs) {
    const current = currentScoreMap.get(fav.personId);
    const prior = priorScoreMap.get(fav.personId);
    if (current == null || prior == null || prior === 0) continue;

    const pctChange = ((current - prior) / prior) * 100;
    if (Math.abs(pctChange) < HOT_MOVER_PCT_THRESHOLD) continue;

    const [recentHotMover] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, fav.userId),
          eq(notifications.kind, "favorite_hot_mover"),
          eq(notifications.entityType, "person"),
          eq(notifications.entityId, fav.personId),
          gte(notifications.createdAt, cooldownSince),
        ),
      )
      .limit(1);
    if (recentHotMover) continue;

    const direction = pctChange > 0 ? "up" : "down";
    const arrow = pctChange > 0 ? "+" : "";
    const personName = personNameMap.get(fav.personId) ?? "Your favorite";
    const title = direction === "up" ? `${personName} is climbing fast` : `${personName} is slipping fast`;

    const id = await createNotification({
      userId: fav.userId,
      kind: "favorite_hot_mover",
      title,
      body: `Trend score ${arrow}${pctChange.toFixed(1)}% in the last 24h.`,
      href: `/person/${fav.personId}`,
      entityType: "person",
      entityId: fav.personId,
      metadata: { direction, pctChange, currentScore: current, priorScore: prior },
      // Audit: throttled to once per (user, person) per ~24h via the
      // explicit cooldown query above (the day-bucket idempotency key
      // is a second-line defense if the cooldown ever races). groupKey
      // gives the client-side panel a collapse target so a person who
      // alternates between climbing fast and slipping fast over several
      // days surfaces as one row with the latest direction.
      groupKey: `favorite_hot_mover:${fav.userId}:${fav.personId}`,
      idempotencyKey: `favhot:${fav.userId}:${fav.personId}:${bucket}`,
    });
    if (id) inserted += 1;
  }

  return inserted;
}

type ClosingSoonMarket = {
  id: string;
  slug: string | null;
  title: string;
  marketType: string;
  engine: string | null;
  closeAt: Date | null;
  endAt: Date | null;
};

type ClosingDigestVariant = "standard" | "jackpot" | "amm";

function closingDigestVariant(m: ClosingSoonMarket): ClosingDigestVariant {
  if (m.engine === "amm") return "amm";
  if (m.marketType === "jackpot") return "jackpot";
  return "standard";
}

function closingSoonTimingLabel(now: Date, closeAt: Date): string {
  const minutesLeft = Math.max(1, Math.round((closeAt.getTime() - now.getTime()) / 60000));
  const hoursLeft = Math.round(minutesLeft / 60);
  return hoursLeft >= 1 ? `${hoursLeft}h` : `${minutesLeft}m`;
}

function closingSoonHref(market: ClosingSoonMarket): string {
  switch (market.marketType) {
    case "updown":
      return `/predict/updown/${market.id}`;
    case "h2h":
      return `/predict/h2h/${market.id}`;
    case "race":
    case "gainer":
      return `/predict/race/${market.id}`;
    default:
      return market.slug ? `/markets/${market.slug}` : "/predict";
  }
}

/**
 * Find markets whose `closeAt` is within the next 24h and ping users
 * who have an open bet on the market. We deliberately do NOT also fan
 * out to "users with a favorite linked to the market" — that's much
 * noisier and harder to reason about. Open-bet-only keeps signal high.
 *
 * Digests: one notification per user per close-cycle milestone per
 * variant (standard betting vs jackpot entries vs AMM). Milestones are
 * 24h / 4h / 1h / 5m — see `CLOSING_MILESTONES`. Within each milestone
 * bucket the row's title/body/metadata refresh silently (via
 * `refreshOnConflict` on the dispatcher) as the time-remaining label
 * drifts; `created_at` and `read_at` are untouched so a user who has
 * already read the row doesn't see it pop unread.
 *
 * Muted markets are excluded before grouping — there is no single
 * `marketId` on digest rows so we filter upfront. Idempotency key is
 * `closing_digest:${userId}:${variant}:${milestoneId}` (no UTC bucket
 * — that was the source of the per-hour repetition).
 */
async function deriveMarketClosingSoon(): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + MARKET_CLOSING_SOON_WINDOW_MS);
  const grace = new Date(now.getTime() - MARKET_CLOSING_SOON_GRACE_MS);

  // Markets that close inside the [now, now+24h] window AND haven't
  // already closed (or are still safely settle-able). The grace lower
  // bound covers tick drift if the job is late by a few minutes; the
  // 24h horizon is the largest milestone — markets further out are
  // filtered later via `currentMilestone` returning null.
  const closingMarkets = await db
    .select({
      id: predictionMarkets.id,
      slug: predictionMarkets.slug,
      title: predictionMarkets.title,
      marketType: predictionMarkets.marketType,
      engine: predictionMarkets.engine,
      closeAt: predictionMarkets.closeAt,
      endAt: predictionMarkets.endAt,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        sql`COALESCE(${predictionMarkets.closeAt}, ${predictionMarkets.endAt}) >= ${grace}`,
        sql`COALESCE(${predictionMarkets.closeAt}, ${predictionMarkets.endAt}) <= ${horizon}`,
      ),
    );

  if (closingMarkets.length === 0) return 0;

  const marketIds = closingMarkets.map((m) => m.id);
  const openBets = await db
    .select({ userId: marketBets.userId, marketId: marketBets.marketId })
    .from(marketBets)
    .where(and(inArray(marketBets.marketId, marketIds), eq(marketBets.status, "active")));

  const closingById = new Map(closingMarkets.map((m) => [m.id, m]));
  const candidates: { userId: string; market: ClosingSoonMarket }[] = [];
  const seenPair = new Set<string>();
  for (const bet of openBets) {
    const pairKey = `${bet.userId}:${bet.marketId}`;
    if (seenPair.has(pairKey)) continue;
    seenPair.add(pairKey);
    const market = closingById.get(bet.marketId);
    if (!market) continue;
    candidates.push({ userId: bet.userId, market });
  }

  if (candidates.length === 0) return 0;

  const distinctUserIds = Array.from(new Set(candidates.map((c) => c.userId)));
  const distinctMarketIds = Array.from(new Set(candidates.map((c) => c.market.id)));

  const muteRows = await db
    .select({
      userId: notificationMarketMutes.userId,
      marketId: notificationMarketMutes.marketId,
    })
    .from(notificationMarketMutes)
    .where(
      and(
        inArray(notificationMarketMutes.userId, distinctUserIds),
        inArray(notificationMarketMutes.marketId, distinctMarketIds),
      ),
    );

  const mutedPairs = new Set(muteRows.map((r) => `${r.userId}:${r.marketId}`));

  const eligible = candidates.filter(
    (c) => !mutedPairs.has(`${c.userId}:${c.market.id}`),
  );

  type Group = { userId: string; variant: ClosingDigestVariant; markets: ClosingSoonMarket[] };
  const groupMap = new Map<string, Group>();
  for (const { userId, market } of eligible) {
    const variant = closingDigestVariant(market);
    const gKey = `${userId}:${variant}`;
    let g = groupMap.get(gKey);
    if (!g) {
      g = { userId, variant, markets: [] };
      groupMap.set(gKey, g);
    }
    g.markets.push(market);
  }

  let inserted = 0;

  for (const { userId, variant, markets } of groupMap.values()) {
    let earliest: Date | null = null;
    for (const m of markets) {
      const ca = m.closeAt ?? m.endAt;
      if (!ca) continue;
      if (!earliest || ca.getTime() < earliest.getTime()) earliest = ca;
    }
    if (!earliest) continue;

    // Gate firing on the milestone schedule. If the group's earliest
    // close is further out than the largest milestone (24h) or has
    // already slipped past close (grace-window markets), skip — the
    // auto-dismiss pass in `runNotificationsDerivation` handles the
    // already-closed case. Without this guard a market closing in 23h
    // would still match the lookahead window but we'd insert a row
    // every cron tick keyed by hour, which is exactly the noise we're
    // trying to remove.
    const timeUntilClose = earliest.getTime() - now.getTime();
    const milestone = currentMilestone(timeUntilClose);
    if (!milestone) continue;

    const timing = closingSoonTimingLabel(now, earliest);
    const title =
      variant === "amm"
        ? `Resolves in ${timing} — last chance to trade`
        : variant === "jackpot"
          ? `Entries close in ${timing}`
          : `Betting closes in ${timing}`;

    const count = markets.length;
    const marketIdsInGroup = markets.map((m) => m.id);

    let body: string;
    let href: string;
    let entityType: string;
    let entityId: string | undefined;

    if (count === 1) {
      const m = markets[0];
      body = m.title;
      href = closingSoonHref(m);
      entityType = "market";
      entityId = m.id;
    } else {
      body =
        variant === "jackpot"
          ? `Entries close soon on ${count} predictions — tap to review`
          : variant === "amm"
            ? `${count} markets resolve soon — tap to review`
            : `Betting closes soon on ${count} predictions — tap to review`;
      href = "/predict";
      entityType = "market_digest";
      entityId = undefined;
    }

    const single = count === 1 ? markets[0] : null;

    const id = await createNotification({
      userId,
      kind: "market_closing_soon",
      title,
      body,
      href,
      entityType,
      entityId,
      metadata: {
        digest: count > 1,
        marketIds: marketIdsInGroup,
        count,
        variant,
        milestone,
        closeAt: earliest.toISOString(),
        ...(single
          ? {
              marketType: single.marketType,
              engine: single.engine ?? "parimutuel",
            }
          : {}),
      },
      // Shared groupKey across every milestone row for this user+variant
      // (one user may still get one row per variant, but inside a variant
      // the four milestone rows fold together client-side via
      // `flattenNotifications`'s groupKey collapse → user sees one
      // "Closes in 5m · +3 earlier" pill instead of four stacked rows).
      groupKey: `market_closing_soon:${userId}:${variant}`,
      idempotencyKey: `closing_digest:${userId}:${variant}:${milestone}`,
      // Inside a milestone bucket the time-remaining label drifts
      // (24h → 12h → 5h → …); refresh so the row stays current without
      // bumping `created_at` or re-marking unread.
      refreshOnConflict: true,
    });
    if (id) inserted += 1;
  }

  return inserted;
}

/**
 * Auto-dismiss closing-soon rows whose referenced markets are no
 * longer OPEN. Runs on the same 10-minute cadence as the deriver so
 * post-close cleanup happens within one tick (typically faster than
 * the user notices). We deliberately stay reactive instead of wiring
 * into [server/native-markets/lifecycle.ts](server/native-markets/lifecycle.ts)
 * / [server/jobs/market-resolver.ts](server/jobs/market-resolver.ts):
 * the cost is one extra UPDATE per tick and we avoid coupling unrelated
 * subsystems.
 *
 * Scope: every notification we emit from `deriveMarketClosingSoon`
 * carries `metadata.marketIds` (single-market rows include one id;
 * digest rows include all of them). The row is safe to dismiss the
 * moment NONE of those markets is still OPEN. Defensive `jsonb_typeof`
 * and `jsonb_array_length` guards prevent us from touching legacy or
 * malformed rows we don't fully understand.
 */
async function dismissClosedMarketClosingSoon(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE ${notifications} AS n
    SET dismissed_at = NOW()
    WHERE n.kind = 'market_closing_soon'
      AND n.dismissed_at IS NULL
      AND jsonb_typeof(n.metadata->'marketIds') = 'array'
      AND jsonb_array_length(n.metadata->'marketIds') > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ${predictionMarkets} pm
        WHERE pm.status = 'OPEN'
          AND pm.id = ANY(
            SELECT jsonb_array_elements_text(n.metadata->'marketIds')
          )
      )
    RETURNING id
  `);
  return (result.rows || []).length;
}

/**
 * Streak milestone notifications. Fires when `currentStreak` crosses a
 * threshold; idempotent on (user, streak) so we never double-fire when
 * the streak counter holds steady at a milestone.
 *
 * Note: streak warnings ("ending soon") would need timezone awareness
 * to be useful — VoxDex doesn't store user timezone yet, so we hold off
 * on the warning variant until that exists. This module covers the
 * positive milestones today.
 *
 * Audit (notifications consolidation): the idempotency key already
 * bakes in the discrete streak value (`streak:${userId}:${value}`), so
 * a user can only hit the "3-day streak" / "7-day streak" / etc.
 * notification ONCE — even if the deriver fires daily for the lifetime
 * of the streak. No groupKey needed: each milestone is a distinct
 * achievement worth its own inbox row.
 */
async function deriveStreakMilestones(): Promise<number> {
  const targets = STREAK_MILESTONES as readonly number[];
  const rows = await db
    .select({ id: profiles.id, currentStreak: profiles.currentStreak })
    .from(profiles)
    .where(inArray(profiles.currentStreak, targets));

  let inserted = 0;
  for (const row of rows) {
    const id = await createNotification({
      userId: row.id,
      kind: "streak_milestone",
      title: `${row.currentStreak}-day streak`,
      body: row.currentStreak >= 30
        ? `Incredible consistency. Keep it going.`
        : `Nice. Show up tomorrow to keep it alive.`,
      href: "/me",
      entityType: "streak",
      entityId: String(row.currentStreak),
      metadata: { streak: row.currentStreak },
      idempotencyKey: `streak:${row.id}:${row.currentStreak}`,
    });
    if (id) inserted += 1;
  }
  return inserted;
}

/**
 * Low-credit reminder. Throttled to once per 7 days via a weekly
 * idempotency bucket ("YYYY-WW"). Threshold is intentionally
 * conservative (100 credits) — we want this to be useful, not annoying.
 *
 * Audit (notifications consolidation): the weekly bucket bounds firing
 * to at most one row per user per ISO week. groupKey deliberately not
 * set — users who hit low credits in week N AND week N+2 want both
 * rows distinct (they were two separate moments of being low). The
 * inbox cap eventually evicts the older one.
 */
async function deriveCreditsLow(): Promise<number> {
  const LOW_THRESHOLD = 100;
  const rows = await db
    .select({ id: profiles.id, predictCredits: profiles.predictCredits })
    .from(profiles)
    .where(and(lt(profiles.predictCredits, LOW_THRESHOLD), gte(profiles.totalPredictions, 1)));

  // Build an ISO week bucket: "YYYY-W##".
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const week = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const bucket = `${now.getUTCFullYear()}-W${week}`;

  let inserted = 0;
  for (const row of rows) {
    const id = await createNotification({
      userId: row.id,
      kind: "credits_low",
      title: `Low on credits`,
      body: `You have ${row.predictCredits.toLocaleString("en-US")} credits left. Top up to keep predicting.`,
      href: "/pricing",
      entityType: "wallet",
      entityId: row.id,
      metadata: { balance: row.predictCredits, threshold: LOW_THRESHOLD },
      idempotencyKey: `creditslow:${row.id}:${bucket}`,
    });
    if (id) inserted += 1;
  }
  return inserted;
}

// Position move alert tunables. Default thresholds defined in the
// pure helper so unit tests can pin the same values; the cooldown
// (how long to silence the same (user, market, entry) after a fire)
// lives here because it's a deriver-level concern, not a wording one.
const POSITION_MOVE_COOLDOWN_HOURS = 12;

/**
 * "Your position moved significantly" deriver.
 *
 * Scans every non-agent profile that holds at least one open AMM buy,
 * computes the percentage swing between their amortized cost basis
 * (`netCreditsIn`) and the current realizable sell quote
 * (`currentValue` — already floored, LMSR-convexity aware via
 * `quoteSell`), and fires a `position_move_alert` when the move
 * crosses ±POSITION_MOVE_PCT_THRESHOLD_DEFAULT (15%).
 *
 * Filters/gates layered on top:
 *   - Dust gate: positions with `netCreditsIn < 100` are ignored
 *     (a 10-credit position swinging 50% trains users to ignore the
 *     kind).
 *   - Cooldown: a 12h lookback on `notifications` for the same
 *     (user, market, entry) — same shape as `favorite_hot_mover`.
 *   - Idempotency: 12h time bucket key as a second-line defense if
 *     the cooldown query races.
 *   - Agent gate + market mute + prefs: handled by `createNotification`.
 *
 * Why per-user iteration: `loadAmmPositionsFor` is the existing tested
 * helper that returns AmmOpenPosition[] for one user with all the math
 * (avgEntryPrice, currentValue, quoteSell fallbacks) baked in. With
 * the userbase small the per-user loop is fine; we can batch later by
 * lifting the helper to multi-user if cron-tick latency creeps up.
 */
async function derivePositionMoveAlerts(): Promise<number> {
  // Find users who hold any open AMM buy on an OPEN or CLOSED_PENDING
  // market. We restrict to non-agents here so the per-user position
  // helper isn't called 56 times for nothing — the dispatcher would
  // still gate at insert, but the upstream work is wasted.
  const userRows = await db
    .select({ userId: marketBets.userId })
    .from(marketBets)
    .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
    .innerJoin(profiles, eq(profiles.id, marketBets.userId))
    .where(
      and(
        eq(predictionMarkets.engine, "amm"),
        eq(profiles.isAgent, false),
        eq(marketBets.actionType, "buy"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    )
    .groupBy(marketBets.userId);

  if (userRows.length === 0) return 0;

  // 12h bucket → guarantees max one notification per (user, market,
  // entry) per 12h even if the cooldown query somehow races.
  const twelveHourBucketMs = 12 * 60 * 60 * 1000;
  const bucket = Math.floor(Date.now() / twelveHourBucketMs);

  const cooldownSince = sql`NOW() - make_interval(hours => ${POSITION_MOVE_COOLDOWN_HOURS})`;

  let inserted = 0;
  for (const { userId } of userRows) {
    let positions;
    try {
      positions = await loadAmmPositionsFor(userId);
    } catch (err) {
      log(
        `[NotificationsDerivation] position_move: loadAmmPositionsFor failed ` +
          `for ${userId}: ${(err as Error)?.message ?? err}`,
      );
      continue;
    }

    for (const pos of positions) {
      const evaluation = evaluatePositionMove({
        netCreditsIn: pos.netCreditsIn,
        currentValue: pos.currentValue,
        pctThreshold: POSITION_MOVE_PCT_THRESHOLD_DEFAULT,
        minNotional: POSITION_MOVE_MIN_NOTIONAL_DEFAULT,
      });
      if (!evaluation) continue;

      const [recent] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.kind, "position_move_alert"),
            eq(notifications.entityType, "market"),
            eq(notifications.entityId, pos.marketId),
            gte(notifications.createdAt, cooldownSince),
          ),
        )
        .limit(1);
      if (recent) continue;

      const subjectLabel = pos.personName ?? pos.marketTitle ?? "Your position";
      const { title, body } = buildPositionMoveNotification({
        subjectLabel,
        evaluation,
      });

      const href = pos.marketSlug ? `/markets/${pos.marketSlug}` : `/me/predictions`;

      const id = await createNotification({
        userId,
        kind: "position_move_alert",
        title,
        body,
        href,
        entityType: "market",
        entityId: pos.marketId,
        marketId: pos.marketId,
        metadata: {
          marketId: pos.marketId,
          entryId: pos.entryId,
          direction: evaluation.direction,
          pctMove: evaluation.pctMove,
          netCreditsIn: evaluation.netCreditsIn,
          currentValue: evaluation.currentValue,
        },
        // groupKey collapses prior alerts on the same position so the
        // panel shows one row per (user, market, entry) rather than a
        // long ladder as the price oscillates above/below threshold.
        groupKey: `position_move_alert:${userId}:${pos.marketId}:${pos.entryId}`,
        idempotencyKey: `position_move:${userId}:${pos.marketId}:${pos.entryId}:${bucket}`,
      });
      if (id) inserted += 1;
    }
  }
  return inserted;
}

/**
 * Weekly P&L digest.
 *
 * Fires every Sunday 18:00-18:30 UTC for users who placed at least one
 * marketBet in the past 7 days. One notification per (user, ISO-week)
 * — re-runs within the fire window absorb into the unique constraint.
 *
 * Scope decision (planning Q&A): "active-only" = users with >=1
 * marketBet in last 7d. Avoids spamming dormant accounts and avoids
 * the dead-week "0 wins, 0 losses" digest that would be noise.
 *
 * Body shape via `formatWeeklyDigestBody`:
 *   "This week: +1,247 credits (8 wins, 3 losses). Best: Jake Paul vs KSI (+470)."
 *
 * What "win"/"loss"/"netCredits" mean here:
 *   - `wins`  = resolved buy rows this week with status='won' AND payoutAmount > 0.
 *               (won-but-zero-payout — the sold-out-before-resolution case from the
 *                AMM-resolver audit — is excluded so we don't inflate the count.)
 *   - `losses` = resolved buy rows this week with status='lost'.
 *   - `netCredits` = sum of (payoutAmount - stakeAmount) over won+lost buys
 *                    PLUS the realised P&L from sells this week (sell stakeAmount
 *                    is stored as -proceeds, so `-stakeAmount` gives the proceeds
 *                    we add into the tally).
 *   - `bestPick` = the single won buy with the largest (payout - stake) profit.
 */
async function deriveWeeklyDigest(): Promise<number> {
  if (!isWeeklyDigestFireWindow()) return 0;

  // Find users active in the past 7 days. `marketBets.createdAt`
  // captures the moment the buy/sell happened, which is what
  // "active this week" should anchor to.
  const sevenDaysAgo = sql`NOW() - INTERVAL '7 days'`;
  const activeUserRows = await db
    .select({ userId: marketBets.userId })
    .from(marketBets)
    .innerJoin(profiles, eq(profiles.id, marketBets.userId))
    .where(
      and(
        eq(profiles.isAgent, false),
        gte(marketBets.createdAt, sevenDaysAgo),
      ),
    )
    .groupBy(marketBets.userId);

  if (activeUserRows.length === 0) return 0;

  const weekBucket = isoYearWeek(new Date());

  let inserted = 0;
  for (const { userId } of activeUserRows) {
    // Per-user roll-up. Three lightweight queries — kept separate for
    // readability rather than one mega-CTE; the active-user count is
    // small at this stage of the product so the round-trip cost is
    // acceptable. If this becomes a hot spot, fold into a single
    // grouped query.
    const settledBuys = await db
      .select({
        marketId: marketBets.marketId,
        stakeAmount: marketBets.stakeAmount,
        payoutAmount: marketBets.payoutAmount,
        status: marketBets.status,
        marketTitle: predictionMarkets.title,
        personName: trackedPeople.name,
      })
      .from(marketBets)
      .innerJoin(predictionMarkets, eq(marketBets.marketId, predictionMarkets.id))
      .leftJoin(trackedPeople, eq(predictionMarkets.personId, trackedPeople.id))
      .where(
        and(
          eq(marketBets.userId, userId),
          eq(marketBets.actionType, "buy"),
          inArray(marketBets.status, ["won", "lost"]),
          gte(marketBets.settledAt, sevenDaysAgo),
        ),
      );

    const sellRows = await db
      .select({
        stakeAmount: marketBets.stakeAmount,
      })
      .from(marketBets)
      .where(
        and(
          eq(marketBets.userId, userId),
          eq(marketBets.actionType, "sell"),
          gte(marketBets.createdAt, sevenDaysAgo),
        ),
      );

    let wins = 0;
    let losses = 0;
    let netCredits = 0;
    let bestPick: WeeklyDigestStats["bestPick"] | undefined;
    for (const bet of settledBuys) {
      const stake = bet.stakeAmount ?? 0;
      const payout = bet.payoutAmount ?? 0;
      if (bet.status === "won" && payout > 0) {
        wins += 1;
        const profit = payout - stake;
        netCredits += profit;
        if (!bestPick || profit > bestPick.profit) {
          bestPick = {
            label: bet.personName ?? bet.marketTitle ?? "Top pick",
            profit,
          };
        }
      } else if (bet.status === "lost") {
        losses += 1;
        netCredits -= stake;
      }
    }
    // Sells: stakeAmount on a sell is stored as -proceeds. The "P&L on
    // a sell" is realised at sell time as `proceeds - sold_shares *
    // avg_buy_cost`, but the full per-share-cost-basis math is heavy
    // — the digest is a roundup, not a leaderboard, so the simpler
    // "proceeds add into your week" reading is acceptable here. The
    // matching debits already showed up in the digest of the week the
    // buys settled (if they did). For week-level roundup purposes, the
    // proceeds count as positive credit flow.
    for (const sell of sellRows) {
      netCredits += -(sell.stakeAmount ?? 0);
    }

    // No notification if the user only sold and never had a resolved
    // win or loss this week — the body would read confusingly.
    if (wins === 0 && losses === 0) continue;

    const body = formatWeeklyDigestBody({ wins, losses, netCredits, bestPick });

    const id = await createNotification({
      userId,
      kind: "weekly_pnl_digest",
      title: WEEKLY_DIGEST_TITLE,
      body,
      href: "/me/predictions",
      entityType: "user",
      entityId: userId,
      metadata: { wins, losses, netCredits, bestPick: bestPick ?? null, week: weekBucket },
      idempotencyKey: `weekly_digest:${userId}:${weekBucket}`,
    });
    if (id) inserted += 1;
  }
  return inserted;
}

// Resolution-imminent: how far before `endAt` to fire the heads-up.
// Six hours is the sweet spot — long enough that a daytime user
// catches it before the resolution lands, short enough that it
// doesn't read as a stale "remember this from days ago" ping. The
// idempotency key is per (user, market) so even if the lookahead
// is widened later, each user gets at most one ping per market.
const RESOLUTION_IMMINENT_LOOKAHEAD_MS = 6 * 60 * 60 * 1000;

/**
 * "You're still holding through resolution" deriver.
 *
 * Scans AMM markets whose `endAt` is within the next 6 hours (and in
 * the future), finds users with non-zero net shares on those markets,
 * fires one notification per (user, market).
 *
 * Why this is separate from `market_closing_soon`:
 *   - `market_closing_soon` covers BETTING close (a moment when the
 *     user could still trade in/out). Fans out at 24h/4h/1h/5m
 *     milestones to anyone with an interest (favorites + position).
 *   - This deriver covers RESOLUTION (a moment when the user can no
 *     longer act, but P&L is about to land). Fans out at a single
 *     6h heads-up only to users with skin in the game.
 *
 * Idempotency: `position_resolution_imminent:${userId}:${marketId}`
 * — once fired, never re-fires for the same position regardless of
 * how many ticks land in the 6h window.
 */
async function derivePositionResolutionImminent(): Promise<number> {
  const lookaheadEnd = new Date(Date.now() + RESOLUTION_IMMINENT_LOOKAHEAD_MS);

  const imminentMarkets = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      endAt: predictionMarkets.endAt,
      personName: trackedPeople.name,
    })
    .from(predictionMarkets)
    .leftJoin(trackedPeople, eq(predictionMarkets.personId, trackedPeople.id))
    .where(
      and(
        eq(predictionMarkets.engine, "amm"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
        gte(predictionMarkets.endAt, sql`NOW()`),
        lte(predictionMarkets.endAt, lookaheadEnd),
      ),
    );

  if (imminentMarkets.length === 0) return 0;

  let inserted = 0;
  for (const market of imminentMarkets) {
    if (!market.endAt) continue;

    // Per-user net shares on this market. Aggregate buys minus sells
    // across all entries — for the heads-up purpose we don't need
    // per-entry breakdown (the user can see that on the market page).
    const positionRows = await db
      .select({
        userId: marketBets.userId,
        actionType: marketBets.actionType,
        shareCount: marketBets.shareCount,
      })
      .from(marketBets)
      .innerJoin(profiles, eq(profiles.id, marketBets.userId))
      .where(
        and(
          eq(marketBets.marketId, market.id),
          eq(profiles.isAgent, false),
          inArray(marketBets.actionType, ["buy", "sell"]),
        ),
      );

    if (positionRows.length === 0) continue;

    // Aggregate: net = sum(buy.shares) - sum(sell.shares) per user.
    const netByUser = new Map<string, number>();
    for (const row of positionRows) {
      const shares = Number(row.shareCount ?? 0);
      if (!Number.isFinite(shares)) continue;
      const delta = row.actionType === "buy" ? shares : -shares;
      netByUser.set(row.userId, (netByUser.get(row.userId) ?? 0) + delta);
    }

    const hoursRemaining =
      (market.endAt.getTime() - Date.now()) / (60 * 60 * 1000);
    const subjectLabel = market.personName ?? market.title ?? "Your position";
    const href = market.slug ? `/markets/${market.slug}` : `/me/predictions`;

    for (const [userId, netShares] of netByUser) {
      if (netShares <= 0.5) continue;

      const { title, body } = formatResolutionImminentNotification({
        subjectLabel,
        netShares,
        hoursRemaining,
      });

      const id = await createNotification({
        userId,
        kind: "position_resolution_imminent",
        title,
        body,
        href,
        entityType: "market",
        entityId: market.id,
        marketId: market.id,
        metadata: {
          marketId: market.id,
          netShares: Math.round(netShares),
          hoursRemaining: Math.max(0, Math.floor(hoursRemaining)),
        },
        idempotencyKey: `position_resolution_imminent:${userId}:${market.id}`,
      });
      if (id) inserted += 1;
    }
  }
  return inserted;
}

/**
 * Single entry point for the scheduler. Wraps every derivation in an
 * advisory lock so concurrent ticks (e.g. blue/green deploys) can't
 * cause double-fanout. Catches per-step errors so one slow query
 * can't starve the rest of the pipeline.
 */
export interface NotificationsDerivationResult {
  acquired: boolean;
  results?: Record<string, number>;
  elapsedMs?: number;
}

export async function runNotificationsDerivation(): Promise<NotificationsDerivationResult> {
  const lock = await withDbAdvisoryLock(DERIVATION_LOCK_KEY, "NotificationsDerivation", async () => {
    const start = Date.now();
    const results: Record<string, number> = {};
    // Closing-soon dismiss runs immediately after the deriver as the
    // logical "cleanup half" of the same pipeline stage. Order is not
    // load-bearing — the deriver only emits for OPEN markets so a
    // market that closed between ticks won't re-fire either way — but
    // grouping them keeps the orchestration readable.
    const steps: Array<[string, () => Promise<number>]> = [
      ["favorite_rank_cross", deriveFavoriteRankCrossings],
      ["favorite_hot_mover", deriveFavoriteHotMovers],
      ["market_closing_soon", deriveMarketClosingSoon],
      ["market_closing_soon_dismiss", dismissClosedMarketClosingSoon],
      ["streak_milestone", deriveStreakMilestones],
      ["credits_low", deriveCreditsLow],
      ["position_move_alert", derivePositionMoveAlerts],
      ["weekly_pnl_digest", deriveWeeklyDigest],
      ["position_resolution_imminent", derivePositionResolutionImminent],
    ];
    for (const [name, fn] of steps) {
      try {
        results[name] = await fn();
      } catch (err) {
        results[name] = -1;
        log(`[NotificationsDerivation] ${name} failed: ${(err as Error)?.message ?? err}`);
      }
    }
    const elapsedMs = Date.now() - start;
    log(`[NotificationsDerivation] tick complete (${elapsedMs}ms): ${JSON.stringify(results)}`);
    return { results, elapsedMs };
  });

  if (!lock.acquired) {
    log("[NotificationsDerivation] tick skipped — another instance holds the lock");
    return { acquired: false };
  }

  return {
    acquired: true,
    results: lock.result?.results,
    elapsedMs: lock.result?.elapsedMs,
  };
}

const DERIVATION_INTERVAL_MS = 10 * 60 * 1000;
const DERIVATION_STARTUP_DELAY_MS = 90_000;
let _timer: ReturnType<typeof setInterval> | null = null;

/**
 * Boot the derivation scheduler. Runs once shortly after startup (so
 * any backlog from downtime gets cleared promptly) then every 10 min
 * thereafter, matching the LiveTick cadence.
 */
export function startNotificationsDerivationScheduler(): void {
  if (_timer) return;
  log(`[NotificationsDerivation] Starting scheduler (every ${DERIVATION_INTERVAL_MS / 60000} min)`);

  setTimeout(() => {
    runNotificationsDerivation().catch((err) =>
      log(`[NotificationsDerivation] startup tick failed: ${(err as Error)?.message ?? err}`),
    );
  }, DERIVATION_STARTUP_DELAY_MS);

  _timer = setInterval(() => {
    runNotificationsDerivation().catch((err) =>
      log(`[NotificationsDerivation] tick failed: ${(err as Error)?.message ?? err}`),
    );
  }, DERIVATION_INTERVAL_MS);

  _timer.unref?.();
}

export function stopNotificationsDerivationScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    log("[NotificationsDerivation] Scheduler stopped");
  }
}
