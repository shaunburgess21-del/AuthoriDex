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

// 6h pre-close warning. Picked from the plan; long enough that "I'll
// log in tonight" still counts, short enough that it isn't ambient
// noise. We only run hourly so the actual lead time varies 5–6h.
const MARKET_CLOSING_SOON_WINDOW_MS = 6 * 60 * 60 * 1000;
const MARKET_CLOSING_SOON_GRACE_MS = 30 * 60 * 1000;

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
 * Find markets whose `closeAt` is within the next ~6h and ping users
 * who have an open bet on the market. We deliberately do NOT also fan
 * out to "users with a favorite linked to the market" — that's much
 * noisier and harder to reason about. Open-bet-only keeps signal high.
 *
 * Digests: one notification per user per UTC hour per message family
 * (standard betting vs jackpot entries vs AMM) so dozens of parallel
 * weekly cards don't spam identical titles. Muted markets are excluded
 * before grouping — there is no single `marketId` on digest rows, so
 * we filter upfront. Idempotency: `closing_digest:${userId}:${hour}:${variant}`.
 */
async function deriveMarketClosingSoon(): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + MARKET_CLOSING_SOON_WINDOW_MS);
  const grace = new Date(now.getTime() - MARKET_CLOSING_SOON_GRACE_MS);

  // Markets that close inside the [now, now+6h] window AND haven't
  // already closed (or are still safely settle-able). The grace upper
  // bound covers tick drift if the job is late by a few minutes.
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

  const bucket = hourBucket(now);
  let inserted = 0;

  for (const { userId, variant, markets } of groupMap.values()) {
    let earliest: Date | null = null;
    for (const m of markets) {
      const ca = m.closeAt ?? m.endAt;
      if (!ca) continue;
      if (!earliest || ca.getTime() < earliest.getTime()) earliest = ca;
    }
    if (!earliest) continue;

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
        closeAt: earliest.toISOString(),
        ...(single
          ? {
              marketType: single.marketType,
              engine: single.engine ?? "parimutuel",
            }
          : {}),
      },
      idempotencyKey: `closing_digest:${userId}:${bucket}:${variant}`,
    });
    if (id) inserted += 1;
  }

  return inserted;
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
    const steps: Array<[string, () => Promise<number>]> = [
      ["favorite_rank_cross", deriveFavoriteRankCrossings],
      ["favorite_hot_mover", deriveFavoriteHotMovers],
      ["market_closing_soon", deriveMarketClosingSoon],
      ["streak_milestone", deriveStreakMilestones],
      ["credits_low", deriveCreditsLow],
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
