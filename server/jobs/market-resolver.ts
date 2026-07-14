import { db, withDbAdvisoryLock } from "../db";
import { predictionMarkets, marketEntries, marketBets, marketAmmState, profiles, creditLedger, trendingPeople } from "@shared/schema";
import { eq, and, sql, inArray, lte } from "drizzle-orm";
import { log } from "../log";
import { computeEarlyBirdMultiplier } from "./settlement-utils";
// `scoreResolvedMarket` used to fire from each resolveX after settlement.
// It's now invoked from inside `resolveAmmMarket` (post-tx fanout) so the
// three resolvers (updown/h2h/gainer) don't need to wire it manually — the
// AMM resolver covers both manual admin settles and the cron path.
import { resolveAmmMarket, type ResolveAmmMarketResult } from "../services/amm-resolver";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { gamificationService } from "../services/gamification";
import { checkAndAwardPredictionWinBadges } from "../services/badges";
import { notificationDayBucket } from "./notification-buckets";
import {
  buildJackpotResolvedLossNotification,
  buildJackpotResolvedWinNotification,
} from "./jackpot-resolved-utils";
import { createNotification } from "../services/notifications";
import OpenAI from "openai";
import { fetchTrendingNewsContext } from "../providers/serper";
import {
  alignCloseMethodsForMarket,
  ensureDate,
  getCloseSnapshot,
  getNativeCloseMedianHours,
  getOpenSnapshot,
  resolveNativeClosePair,
  type MedianCloseSnapshot,
} from "./market-snapshot-resolution";

/**
 * Official hourly closes to median for native settlement (blunts weekend
 * boundary / last-hour pumps). Shared by up/down, H2H, and gainer via
 * `getNativeCloseMedianHours()` (default 6). Set NATIVE_CLOSE_MEDIAN_HOURS=1
 * to restore legacy single-snapshot close.
 */

const RESOLVER_INTERVAL_MS = 5 * 60 * 1000;
const RESOLVER_STARTUP_DELAY_MS = 2 * 60 * 1000;
const MARKET_RESOLVER_LOCK_KEY = 5_202;
const LEGACY_BLOCK_AUTO_VOID_DAYS = 14;

/**
 * Gainer (race) tie threshold, in **percentage points**.
 *
 * `pctChange` for each entry is computed as
 * `((closeScore - openScore) / openScore) * 100`, so a value of `0.01`
 * here means "two entries whose pctChange agrees to two decimal places
 * are treated as tied, and the market auto-voids."
 *
 * Two-decimal precision matches what we display everywhere in the UI
 * (the `pctChange.toFixed(2) + "%"` evidence written into
 * `resolution_notes`, the leaderboard cells, the share cards, etc.),
 * so a pair that *looks* identical to a user is correctly flagged
 * here. The previous `0.001` was so tight it would only fire on a
 * literal floating-point match — a real-world tie at 5.12% vs 5.13%
 * would have arbitrarily picked one side as the winner.
 *
 * Kept as a code constant rather than an `amm_runtime_settings` knob:
 * there's no operational reason to vary "do these two numbers round
 * to the same display value" at runtime, and a redeploy is the right
 * cadence if we ever decide we want a different precision floor.
 */
export const GAINER_TIE_EPSILON_PCT = 0.01;

/**
 * Pure predicate exposed for unit testing. Returns true iff the two
 * pctChange values are within `GAINER_TIE_EPSILON_PCT` percentage
 * points of each other, i.e. should be auto-voided as a tie.
 *
 * Both inputs are expected to be finite numbers in **percentage
 * points** (the same units as `pctChange` in `resolveGainer`). NaN /
 * Infinity inputs return `false` so callers fall through to the
 * normal winner-pick path — a NaN race can't sensibly be tied.
 *
 * Edge case: a "nominal 0.01 gap" like `5.12` vs `5.13` evaluates to
 * `Math.abs(5.12 - 5.13) === 0.00999...` in IEEE-754, so it satisfies
 * the strict-less-than and is treated as a tie. This is intentional —
 * an exactly-0.01-percentage-point gap is operationally indistinguishable
 * from noise in the underlying score snapshots, and voiding is the
 * safe call. Pairs that are clearly farther apart (e.g. `5.12` vs `5.14`,
 * gap `0.02`) are correctly NOT tied.
 */
export function isGainerTie(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < GAINER_TIE_EPSILON_PCT;
}

/**
 * Compose the JSON payload we persist into `prediction_markets.resolution_notes`
 * for AMM-resolved (or auto-voided) native markets.
 *
 * The seed-return drift health check
 * (`server/jobs/amm-health.ts::checkSeedReturnDrift`) filters resolved markets
 * with `resolution_notes::jsonb ? 'creditedToHouse' AND ? 'payoutLiability'`.
 * Without those keys present in the JSON, native auto-resolved markets were
 * silently excluded from the audit (they only appeared in process logs). This
 * helper guarantees both keys are written for every native AMM resolution path
 * so the weekly drift audit covers every resolved native, every time.
 *
 * `engine: "amm"` is preserved for filterability in admin queries / dashboards.
 */
function buildAmmResolutionNotes(
  evidence: Record<string, unknown>,
  outcome: string,
  ammResult: ResolveAmmMarketResult,
): Record<string, unknown> {
  return {
    ...evidence,
    outcome,
    engine: "amm",
    creditedToHouse: ammResult.creditedToHouse,
    payoutLiability: ammResult.payoutLiability,
    settledUserCount: ammResult.settledUserCount,
  };
}

/**
 * Test-only export. Lets the unit suite assert the helper's contract
 * (creditedToHouse + payoutLiability keys present, evidence preserved,
 * outcome+engine stamped) without spinning up a DB.
 */
export function _buildAmmResolutionNotesForTesting(
  evidence: Record<string, unknown>,
  outcome: string,
  ammResult: ResolveAmmMarketResult,
): Record<string, unknown> {
  return buildAmmResolutionNotes(evidence, outcome, ammResult);
}

let _lastResolverRunAt: Date | null = null;
export function getLastResolverRunAt(): Date | null { return _lastResolverRunAt; }

interface ResolverStats {
  lastRunAt: string | null;
  marketsFound: number;
  resolved: number;
  voided: number;
  blocked: number;
  skipped: number;
  errors: number;
  pendingAdmin: number;
}

let _resolverStats: ResolverStats = {
  lastRunAt: null,
  marketsFound: 0,
  resolved: 0,
  voided: 0,
  blocked: 0,
  skipped: 0,
  errors: 0,
  pendingAdmin: 0,
};

export function getResolverStats(): ResolverStats {
  return { ..._resolverStats };
}

/**
 * Fire-and-forget: write a one-sentence neutral summary to
 * `prediction_markets.resolution_summary`. Settlement never blocks on this —
 * any failure is logged and swallowed. Idempotent: skips if the column is
 * already populated.
 *
 * Volume is low (markets resolve ~weekly; dozens per week at launch), so a
 * single default model call per market is acceptable without extra caching.
 */
export async function generateResolutionSummary(marketId: string): Promise<void> {
  try {
    const [market] = await db
      .select()
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);
    if (!market) return;
    if (market.resolutionSummary) return; // idempotent — don't regenerate
    if (market.status !== "RESOLVED") return; // only summarize successful settlements
    // Native + community (World Markets). The community detail endpoint
    // still synthesizes its own resolutionSummary OBJECT from
    // resolutionNotes (and overrides the raw column in its response), so
    // writing the text column is safe there; /me/predictions surfaces the
    // text directly for both.
    if (!["h2h", "updown", "gainer", "jackpot", "community"].includes(market.marketType)) return;

    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      log(`[ResolutionSummary] ${marketId}: no OpenAI key, skipping`);
      return;
    }

    const entries = await db
      .select()
      .from(marketEntries)
      .where(eq(marketEntries.marketId, marketId));
    const winner = entries.find(e => e.resolutionStatus === "winner");
    const loser = entries.find(e => e.resolutionStatus === "loser");
    if (!winner) return;

    const isCommunity = market.marketType === "community";

    // For H2H / gainer / updown, try to anchor the summary in one headline
    // about the winning person. updown's "winner" is Up/Down (no person), so
    // we fall back to the market's linked personId in that case. Community
    // (world-event) markets skip the person/news anchor — the market title
    // and resolution criteria carry the context.
    let winningPersonId: string | null = isCommunity ? null : (winner.personId ?? null);
    if (!winningPersonId && market.marketType === "updown" && market.personId) {
      winningPersonId = market.personId;
    }

    let winningPersonName: string | null = null;
    if (winningPersonId) {
      const [person] = await db
        .select({ name: trendingPeople.name })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, winningPersonId))
        .limit(1);
      winningPersonName = person?.name ?? null;
    }

    let headlineLine = "";
    if (winningPersonName) {
      try {
        const newsContext = await fetchTrendingNewsContext(winningPersonName);
        if (newsContext && newsContext.sources.length > 0) {
          headlineLine = `Recent headline: ${newsContext.sources[0].title}`;
        }
      } catch (err: any) {
        log(`[ResolutionSummary] ${marketId}: news fetch failed (${err?.message ?? err}), continuing without headline`);
      }
    }

    // Extract the percent margin for updown / gainer from resolutionNotes
    // (it's JSON-stringified by the resolvers above). Community notes carry
    // no margin; use the resolution criteria as factual context instead.
    let marginLine = "";
    if (!isCommunity && market.resolutionNotes) {
      try {
        const notes = JSON.parse(market.resolutionNotes);
        if (typeof notes?.percentChange === "string") {
          marginLine = `Margin: ${notes.percentChange}.`;
        } else if (Array.isArray(notes?.rankings) && notes.rankings[0]?.pctChange) {
          marginLine = `Winning gain: ${notes.rankings[0].pctChange}.`;
        }
      } catch {}
    }

    let criteriaLine = "";
    if (isCommunity && Array.isArray(market.resolutionCriteria) && market.resolutionCriteria.length > 0) {
      criteriaLine = `Resolution criteria: ${market.resolutionCriteria.slice(0, 3).join("; ")}`;
    }

    const marketTypeLabel = market.marketType === "h2h"
      ? "head-to-head"
      : market.marketType === "gainer"
        ? "top-gainer"
        : market.marketType === "updown"
          ? "up/down"
          : isCommunity
            ? "real-world event"
            : market.marketType;

    const systemPrompt = `You write one-sentence neutral summaries for resolved prediction markets, in the style of a wire-service headline. Past tense. No opinions. No hype words (never use: backlash, scandal, controversy, embattled, slammed, blasted, divisive, polarizing). If a headline is provided, you may reference its event only as a factual anchor — never characterize public reaction.`;

    const userPrompt = `Write ONE sentence (max 25 words) summarising this resolved ${marketTypeLabel} prediction market.

Market title: ${market.title}
Winner: ${winner.label}${winningPersonName && winningPersonName !== winner.label ? ` (${winningPersonName})` : ""}
${loser && !isCommunity ? `Loser: ${loser.label}` : ""}
${marginLine}
${criteriaLine}
${headlineLine}

Rules:
- Past tense.
- Name the winner first.
- If a margin is provided, include it briefly.
- If a recent headline is provided and relevant, you may reference what happened in neutral terms.
- Return ONLY the sentence — no quotes, no JSON, no explanation.`;

    const openai = new OpenAI({ apiKey });
    const model = getAiModel("marketResolver");
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      ...getChatCompletionTokenLimit(model, 120),
      temperature: 0.4,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (!summary) {
      log(`[ResolutionSummary] ${marketId}: empty LLM response, skipping write`);
      return;
    }

    // Strip any wrapping quotes the model might emit despite the rules.
    const cleaned = summary.replace(/^['"\s]+|['"\s]+$/g, "").slice(0, 500);

    await db
      .update(predictionMarkets)
      .set({ resolutionSummary: cleaned, updatedAt: new Date() })
      .where(and(
        eq(predictionMarkets.id, marketId),
        sql`${predictionMarkets.resolutionSummary} IS NULL`, // race-safe
      ));

    log(`[ResolutionSummary] ${marketId}: wrote summary (${cleaned.length} chars)`);
  } catch (err: any) {
    // Fail open — settlement already succeeded.
    log(`[ResolutionSummary] ${marketId}: generation failed: ${err?.message ?? err}`);
  }
}

// `settleMarketBets` (parimutuel pool-split settlement) was removed in
// the parimutuel sunset. Non-jackpot markets resolve via
// `resolveAmmMarket` (LMSR share payout + seed return); jackpot has its
// own embedded settlement loop inside `resolveJackpot` below; voids run
// through `voidMarketBets` (jackpot stake refund). The notification
// fanout that lived here also moved into `resolveAmmMarket` so AMM
// resolutions get the same win/loss/refund pings. Badge fanout for AMM
// wins is wired inside `resolveAmmMarket`'s post-settlement loop.

export async function voidMarketBets(marketId: string): Promise<number> {
  const refundedCount = await db.transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx
      .update(predictionMarkets)
      .set({ status: "VOID", resolvedAt: now, updatedAt: now })
      .where(and(
        eq(predictionMarkets.id, marketId),
        sql`${predictionMarkets.status} NOT IN ('VOID', 'RESOLVED')`
      ))
      .returning({ id: predictionMarkets.id });

    if (claimed.length === 0) {
      log(`[MarketResolver] Void skipped: market=${marketId} already settled`);
      return 0;
    }

    const allBets = await tx
      .select({ id: marketBets.id, userId: marketBets.userId, stakeAmount: marketBets.stakeAmount })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

    for (const bet of allBets) {
      await tx.update(marketBets)
        .set({ status: "refunded", settledAt: now, payoutAmount: bet.stakeAmount })
        .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));

      const [updatedProfile] = await tx.update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${bet.stakeAmount}` })
        .where(eq(profiles.id, bet.userId))
        .returning({ predictCredits: profiles.predictCredits });

      await tx.insert(creditLedger).values({
        userId: bet.userId,
        txnType: 'prediction_refund',
        amount: bet.stakeAmount,
        walletType: 'VIRTUAL',
        balanceAfter: updatedProfile?.predictCredits ?? 0,
        source: 'market_void',
        idempotencyKey: `refund_${marketId}_${bet.id}`,
        metadata: { marketId, betId: bet.id, stakeAmount: bet.stakeAmount },
      }).onConflictDoNothing();
    }

    await tx.update(marketEntries)
      .set({ resolutionStatus: "void" })
      .where(eq(marketEntries.marketId, marketId));

    return allBets.length;
  });

  log(`[MarketResolver] Void: market=${marketId}, refunded=${refundedCount} bets`);

  // Fanout `market_void_refund` to every user who had an active bet.
  // Best-effort, post-transaction; failures here must not undo the void.
  if (refundedCount > 0) {
    try {
      const refundedBets = await db
        .select({ id: marketBets.id, userId: marketBets.userId, stakeAmount: marketBets.stakeAmount })
        .from(marketBets)
        .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "refunded")));

      const [marketMeta] = await db
        .select({ title: predictionMarkets.title, slug: predictionMarkets.slug })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, marketId));

      const marketTitle = marketMeta?.title ?? "A market you bet on";
      const href = marketMeta?.slug ? `/markets/${marketMeta.slug}` : `/me/predictions`;

      const voidDayBucket = notificationDayBucket();
      for (const bet of refundedBets) {
        await createNotification({
          userId: bet.userId,
          kind: "market_void_refund",
          title: `Market voided — ${bet.stakeAmount.toLocaleString("en-US")} credits refunded`,
          body: `${marketTitle} was voided. Your stake is back in your wallet.`,
          href,
          entityType: "market",
          entityId: marketId,
          marketId,
          metadata: { betId: bet.id, refund: bet.stakeAmount },
          groupKey: `market_void_refund:${bet.userId}:${voidDayBucket}`,
          idempotencyKey: `market_void_refund:${marketId}:${bet.id}`,
        });
      }
    } catch (err) {
      log(`[Notifications] voidMarketBets fanout failed for ${marketId}: ${(err as Error)?.message ?? err}`);
    }
  }

  return refundedCount;
}

/**
 * Pure helper — compares single-point vs median close outcomes for audit
 * logging in resolution_notes. Exported for unit tests.
 */
export function upDownOutcomeFromScores(
  openScore: number,
  closeScore: number,
): "Up" | "Down" | "void_tie" {
  if (closeScore === openScore) return "void_tie";
  return closeScore > openScore ? "Up" : "Down";
}

export async function resolveUpDownMarket(market: any): Promise<"resolved" | "voided" | "blocked"> {
  // Parimutuel sunset: AMM-only path. Tie always voids — LMSR has no
  // way to break a tie at settlement (the marginal price on a 50/50
  // doesn't tell us which entry "should" win), so we refund net credits
  // and return seed to the house via `resolveAmmMarket`.
  if (market.engine !== "amm") {
    log(`[MarketResolver] updown ${market.id}: non-AMM market (legacy parimutuel) — skipping; run scripts/sunset-void-inflight.ts to clean up`);
    return "blocked";
  }
  const personId = market.personId;
  if (!personId) {
    log(`[MarketResolver] updown ${market.id}: no personId, skipping`);
    return "blocked";
  }

  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  const upEntry = entries.find(e => e.label?.toLowerCase() === "up");
  const downEntry = entries.find(e => e.label?.toLowerCase() === "down");
  if (!upEntry || !downEntry) {
    log(`[MarketResolver] updown ${market.id}: missing Up/Down entries, skipping`);
    return "blocked";
  }

  const openSnap = await getOpenSnapshot(personId, market.startAt, market);
  const closePair = await resolveNativeClosePair(personId, market.endAt);
  if (!openSnap || !closePair) {
    log(`[MarketResolver] updown ${market.id}: missing snapshots (open=${!!openSnap}, close=${!!closePair}), marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const closeSnap = closePair.settled;
  const singleClose = closePair.single;
  const windowHours = getNativeCloseMedianHours();
  const settledOutcome = upDownOutcomeFromScores(openSnap.score, closeSnap.score);
  const singleOutcome = singleClose
    ? upDownOutcomeFromScores(openSnap.score, singleClose.score)
    : null;
  const winnerWouldFlip =
    singleOutcome != null && singleOutcome !== settledOutcome;

  const evidence = {
    type: "updown",
    personId,
    openScore: openSnap.score,
    openSnapshotAt: openSnap.capturedAt.toISOString(),
    closeScore: closeSnap.score,
    closeSnapshotAt: closeSnap.capturedAt.toISOString(),
    closeMethod: closeSnap.method,
    closeWindowHours: windowHours,
    closeSampleCount: closeSnap.sampleCount,
    singleCloseScore: singleClose?.score ?? null,
    singleCloseSnapshotAt: singleClose?.capturedAt?.toISOString?.() ?? null,
    singleOutcome,
    winnerWouldFlip,
    change: closeSnap.score - openSnap.score,
    percentChange: openSnap.score > 0 ? ((closeSnap.score - openSnap.score) / openSnap.score * 100).toFixed(2) + "%" : "N/A",
  };

  if (settledOutcome === "void_tie") {
    const ammResult = await resolveAmmMarket({
      marketId: market.id,
      voidMarket: true,
      settledBy: null,
      voidReason: "amm_auto_tie",
    });
    if ("error" in ammResult) {
      log(`[MarketResolver] updown ${market.id}: AMM void failed: ${ammResult.error} ${ammResult.message}`);
      return "blocked";
    }
    await db.update(predictionMarkets).set({
      resolveMethod: "auto",
      voidReason: "Tie — score unchanged",
      resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, "void_tie", ammResult)),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] updown ${market.id}: AMM VOID (tie), house P&L=${ammResult.creditedToHouse}`);
    return "voided";
  }

  const winnerId = settledOutcome === "Up" ? upEntry.id : downEntry.id;
  const winnerLabel = settledOutcome;

  const ammResult = await resolveAmmMarket({
    marketId: market.id,
    winnerEntryId: winnerId,
    settledBy: null,
  });
  if ("error" in ammResult) {
    log(`[MarketResolver] updown ${market.id}: AMM resolve failed: ${ammResult.error} ${ammResult.message}`);
    return "blocked";
  }
  await db.update(predictionMarkets).set({
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, winnerLabel, ammResult)),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));
  log(
    `[MarketResolver] updown ${market.id}: AMM ${winnerLabel} wins (${openSnap.score} → ${closeSnap.score}, ` +
      `method=${evidence.closeMethod}, flip=${winnerWouldFlip}), ` +
      `payoutLiability=${ammResult.payoutLiability}, house P&L=${ammResult.creditedToHouse}, settledUsers=${ammResult.settledUserCount}`,
  );
  return "resolved";
}

async function resolveH2H(market: any): Promise<"resolved" | "voided" | "blocked"> {
  // Parimutuel sunset: AMM-only. Ties always void via the AMM resolver.
  if (market.engine !== "amm") {
    log(`[MarketResolver] h2h ${market.id}: non-AMM market (legacy parimutuel) — skipping; run scripts/sunset-void-inflight.ts to clean up`);
    return "blocked";
  }
  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  if (entries.length !== 2) {
    log(`[MarketResolver] h2h ${market.id}: expected 2 entries, got ${entries.length}, skipping`);
    return "blocked";
  }

  const [entryA, entryB] = entries.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  if (!entryA.personId || !entryB.personId) {
    log(`[MarketResolver] h2h ${market.id}: entries missing personId, skipping`);
    return "blocked";
  }

  const pairA = await resolveNativeClosePair(entryA.personId, market.endAt);
  const pairB = await resolveNativeClosePair(entryB.personId, market.endAt);
  if (!pairA || !pairB) {
    log(`[MarketResolver] h2h ${market.id}: missing close snapshots, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const [closeA, closeB] = alignCloseMethodsForMarket([pairA, pairB]);
  const singleA = pairA.single;
  const singleB = pairB.single;
  const windowHours = getNativeCloseMedianHours();
  const marketCloseMethod =
    closeA.method === "single" || closeB.method === "single" ? "single" : "median";

  const singleWinnerLabel =
    singleA && singleB
      ? singleA.score === singleB.score
        ? "void_tie"
        : singleA.score > singleB.score
          ? entryA.label
          : entryB.label
      : null;
  const settledWinnerLabel =
    closeA.score === closeB.score
      ? "void_tie"
      : closeA.score > closeB.score
        ? entryA.label
        : entryB.label;
  const winnerWouldFlip =
    singleWinnerLabel != null && singleWinnerLabel !== settledWinnerLabel;

  const evidence = {
    type: "h2h",
    closeMethod: marketCloseMethod,
    entryA: {
      personId: entryA.personId,
      label: entryA.label,
      score: closeA.score,
      snapshotAt: closeA.capturedAt.toISOString(),
      closeMethod: closeA.method,
      sampleCount: closeA.sampleCount,
      singleScore: singleA?.score ?? null,
    },
    entryB: {
      personId: entryB.personId,
      label: entryB.label,
      score: closeB.score,
      snapshotAt: closeB.capturedAt.toISOString(),
      closeMethod: closeB.method,
      sampleCount: closeB.sampleCount,
      singleScore: singleB?.score ?? null,
    },
    closeWindowHours: windowHours,
    singleOutcome: singleWinnerLabel,
    winnerWouldFlip,
  };

  if (closeA.score === closeB.score) {
    const ammResult = await resolveAmmMarket({
      marketId: market.id,
      voidMarket: true,
      settledBy: null,
      voidReason: "amm_auto_tie",
    });
    if ("error" in ammResult) {
      log(`[MarketResolver] h2h ${market.id}: AMM void failed: ${ammResult.error} ${ammResult.message}`);
      return "blocked";
    }
    await db.update(predictionMarkets).set({
      resolveMethod: "auto",
      voidReason: "Tie — identical scores",
      resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, "void_tie", ammResult)),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] h2h ${market.id}: AMM VOID (tie at ${closeA.score}), house P&L=${ammResult.creditedToHouse}`);
    return "voided";
  }

  const winner = closeA.score > closeB.score ? entryA : entryB;
  const ammResult = await resolveAmmMarket({
    marketId: market.id,
    winnerEntryId: winner.id,
    settledBy: null,
  });
  if ("error" in ammResult) {
    log(`[MarketResolver] h2h ${market.id}: AMM resolve failed: ${ammResult.error} ${ammResult.message}`);
    return "blocked";
  }
  await db.update(predictionMarkets).set({
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, winner.label, ammResult)),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));
  log(
    `[MarketResolver] h2h ${market.id}: AMM ${winner.label} wins (${closeA.score} vs ${closeB.score}, ` +
      `flip=${winnerWouldFlip}), payoutLiability=${ammResult.payoutLiability}, ` +
      `house P&L=${ammResult.creditedToHouse}, settledUsers=${ammResult.settledUserCount}`,
  );
  return "resolved";
}

async function resolveGainer(market: any): Promise<"resolved" | "voided" | "blocked"> {
  // Parimutuel sunset: AMM-only. Ties always void via the AMM resolver.
  if (market.engine !== "amm") {
    log(`[MarketResolver] gainer ${market.id}: non-AMM market (legacy parimutuel) — skipping; run scripts/sunset-void-inflight.ts to clean up`);
    return "blocked";
  }
  const entries = await db.select().from(marketEntries).where(eq(marketEntries.marketId, market.id));
  if (entries.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no entries, skipping`);
    return "blocked";
  }

  const entriesWithPersonId = entries.filter(e => e.personId);
  if (entriesWithPersonId.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no entries with personId, skipping`);
    return "blocked";
  }

  type GainRow = {
    entry: (typeof entries)[0];
    openScore: number;
    closeScore: number;
    pctChange: number;
    closeMethod: string;
    sampleCount: number;
    singleCloseScore: number | null;
    singlePctChange: number | null;
  };

  const pending: Array<{
    entry: (typeof entries)[0];
    openScore: number;
    pair: NonNullable<Awaited<ReturnType<typeof resolveNativeClosePair>>>;
  }> = [];

  for (const entry of entriesWithPersonId) {
    const openSnap = await getOpenSnapshot(entry.personId!, market.startAt, market);
    const pair = await resolveNativeClosePair(entry.personId!, market.endAt);
    if (!openSnap || !pair) continue;
    pending.push({ entry, openScore: openSnap.score, pair });
  }

  if (pending.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no valid snapshots for any entry, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const alignedCloses = alignCloseMethodsForMarket(pending.map((p) => p.pair));
  const gains: GainRow[] = pending.map((p, i) => {
    const closeSnap: MedianCloseSnapshot = alignedCloses[i]!;
    const pctChange =
      p.openScore > 0 ? ((closeSnap.score - p.openScore) / p.openScore) * 100 : 0;
    const singleCloseScore = p.pair.single?.score ?? null;
    const singlePctChange =
      singleCloseScore != null && p.openScore > 0
        ? ((singleCloseScore - p.openScore) / p.openScore) * 100
        : singleCloseScore != null
          ? 0
          : null;
    return {
      entry: p.entry,
      openScore: p.openScore,
      closeScore: closeSnap.score,
      pctChange,
      closeMethod: closeSnap.method,
      sampleCount: closeSnap.sampleCount,
      singleCloseScore,
      singlePctChange,
    };
  });

  gains.sort((a, b) => b.pctChange - a.pctChange);

  const singleRankable = gains.filter((g) => g.singlePctChange != null);
  let singleOutcome: string | null = null;
  if (singleRankable.length === gains.length && gains.length > 0) {
    const bySingle = [...gains].sort(
      (a, b) => (b.singlePctChange ?? -Infinity) - (a.singlePctChange ?? -Infinity),
    );
    if (
      bySingle.length >= 2 &&
      isGainerTie(bySingle[0]!.singlePctChange!, bySingle[1]!.singlePctChange!)
    ) {
      singleOutcome = "void_tie";
    } else {
      singleOutcome = bySingle[0]!.entry.label;
    }
  }

  const settledOutcome =
    gains.length >= 2 && isGainerTie(gains[0]!.pctChange, gains[1]!.pctChange)
      ? "void_tie"
      : gains[0]!.entry.label;
  const winnerWouldFlip =
    singleOutcome != null && singleOutcome !== settledOutcome;
  const marketCloseMethod = gains.some((g) => g.closeMethod === "single")
    ? "single"
    : "median";

  const evidence = {
    type: "gainer",
    closeMethod: marketCloseMethod,
    closeWindowHours: getNativeCloseMedianHours(),
    singleOutcome,
    winnerWouldFlip,
    rankings: gains.map((g) => ({
      personId: g.entry.personId,
      label: g.entry.label,
      openScore: g.openScore,
      closeScore: g.closeScore,
      pctChange: g.pctChange.toFixed(2) + "%",
      closeMethod: g.closeMethod,
      sampleCount: g.sampleCount,
      singleCloseScore: g.singleCloseScore,
      singlePctChange:
        g.singlePctChange != null ? g.singlePctChange.toFixed(2) + "%" : null,
    })),
  };

  if (gains.length >= 2 && isGainerTie(gains[0].pctChange, gains[1].pctChange)) {
    const ammResult = await resolveAmmMarket({
      marketId: market.id,
      voidMarket: true,
      settledBy: null,
      voidReason: "amm_auto_tie",
    });
    if ("error" in ammResult) {
      log(`[MarketResolver] gainer ${market.id}: AMM void failed: ${ammResult.error} ${ammResult.message}`);
      return "blocked";
    }
    await db.update(predictionMarkets).set({
      resolveMethod: "auto",
      voidReason: "Tie — identical top gain percentage",
      resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, "void_tie", ammResult)),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(
      `[MarketResolver] gainer ${market.id}: AMM VOID (tied within ${GAINER_TIE_EPSILON_PCT}pct: ` +
        `${gains[0].pctChange.toFixed(2)}% vs ${gains[1].pctChange.toFixed(2)}%), ` +
        `house P&L=${ammResult.creditedToHouse}`,
    );
    return "voided";
  }

  const winner = gains[0].entry;
  const ammResult = await resolveAmmMarket({
    marketId: market.id,
    winnerEntryId: winner.id,
    settledBy: null,
  });
  if ("error" in ammResult) {
    log(`[MarketResolver] gainer ${market.id}: AMM resolve failed: ${ammResult.error} ${ammResult.message}`);
    return "blocked";
  }
  await db.update(predictionMarkets).set({
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify(buildAmmResolutionNotes(evidence, winner.label, ammResult)),
    updatedAt: new Date(),
  }).where(eq(predictionMarkets.id, market.id));
  log(
    `[MarketResolver] gainer ${market.id}: AMM ${winner.label} wins (+${gains[0].pctChange.toFixed(2)}%, ` +
      `method=${marketCloseMethod}, flip=${winnerWouldFlip}), ` +
      `payoutLiability=${ammResult.payoutLiability}, house P&L=${ammResult.creditedToHouse}, settledUsers=${ammResult.settledUserCount}`,
  );
  return "resolved";
}

/**
 * Resolve a jackpot market against the closing snapshot's authority score.
 *
 * Exported so the `/api/admin/native-markets/:marketId/force-resolve-jackpot`
 * smoke endpoint can drive the same resolution path without waiting for
 * the cron loop to pick it up.
 *
 * Pass `actualScoreOverride` to bypass `getCloseSnapshot` entirely — only
 * the env-gated force-resolve endpoint uses this so the cron path is
 * untouched.
 */
export async function resolveJackpot(
  market: any,
  actualScoreOverride?: number,
): Promise<"resolved" | "blocked"> {
  const personId = market.personId;
  let closeSnap: Awaited<ReturnType<typeof getCloseSnapshot>> | null = null;
  let actualScore: number;

  if (typeof actualScoreOverride === "number" && Number.isFinite(actualScoreOverride)) {
    actualScore = Math.round(actualScoreOverride);
    log(`[MarketResolver] jackpot ${market.id}: using overridden actualScore=${actualScore} (force-resolve path)`);
  } else {
    if (!personId) {
      log(`[MarketResolver] jackpot ${market.id}: no personId, skipping`);
      return "blocked";
    }
    closeSnap = await getCloseSnapshot(personId, market.endAt);
    if (!closeSnap) {
      log(`[MarketResolver] jackpot ${market.id}: no snapshot available yet, will retry`);
      return "blocked";
    }
    actualScore = Math.round(closeSnap.score);
  }

  const allBets = await db
    .select({
      id: marketBets.id,
      userId: marketBets.userId,
      stakeAmount: marketBets.stakeAmount,
      betMetadata: marketBets.betMetadata,
      createdAt: marketBets.createdAt,
    })
    .from(marketBets)
    .where(and(eq(marketBets.marketId, market.id), eq(marketBets.status, "active")));

  if (allBets.length === 0) {
    await db.update(predictionMarkets).set({
      status: "RESOLVED",
      resolvedAt: new Date(),
      updatedAt: new Date(),
      resolutionNotes: JSON.stringify({
        type: "jackpot",
        actualScore,
        totalEntries: 0,
        outcome: "no_entries",
      }),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] jackpot ${market.id}: no bets, resolved as empty`);
    return "resolved";
  }

  const totalPool = allBets.reduce((sum, b) => sum + b.stakeAmount, 0);

  const allBetsWithScore = allBets.map(b => {
    const meta = b.betMetadata as Record<string, unknown> | null;
    const raw = Number(meta?.predictedScore);
    const predictedScore = Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null;
    return { ...b, predictedScore };
  });

  const validBets = allBetsWithScore.filter(b => b.predictedScore !== null) as (typeof allBetsWithScore[number] & { predictedScore: number })[];
  const invalidBets = allBetsWithScore.filter(b => b.predictedScore === null);

  if (invalidBets.length > 0) {
    log(`[MarketResolver] jackpot ${market.id}: ${invalidBets.length} bet(s) with invalid predictedScore, treating as losers`);
  }

  const betsWithDiff = validBets.map(b => ({
    ...b,
    diff: Math.abs(b.predictedScore - actualScore),
  }));

  if (betsWithDiff.length === 0) {
    log(`[MarketResolver] jackpot ${market.id}: all bets have invalid predictions, treating as losers`);
  }

  betsWithDiff.sort((a, b) => a.diff - b.diff);
  const smallestDiff = betsWithDiff.length > 0 ? betsWithDiff[0].diff : Infinity;
  const winners = betsWithDiff.filter(b => b.diff === smallestDiff);
  const losers = [...betsWithDiff.filter(b => b.diff !== smallestDiff), ...invalidBets];

  const now = new Date();

  await db.transaction(async (tx) => {
    const winnersWithWeight = winners.map(w => ({
      ...w,
      weight: w.stakeAmount * computeEarlyBirdMultiplier(w.createdAt, market.startAt, market.closeAt),
    }));
    const totalWeight = winnersWithWeight.reduce((sum, w) => sum + w.weight, 0);
    const totalWinnerStake = winnersWithWeight.reduce((sum, w) => sum + w.stakeAmount, 0);
    // Mirror calculateSettlementPayouts: only the loser pool is reweighted.
    // Winners always get their base stake back, guaranteeing no correct
    // jackpot pick ever loses credits.
    const winningsPool = Math.max(0, totalPool - totalWinnerStake);
    let distributed = 0;

    for (let i = 0; i < winnersWithWeight.length; i++) {
      const w = winnersWithWeight[i];
      const isLast = i === winnersWithWeight.length - 1;
      const rawShare = totalWeight > 0
        ? w.stakeAmount + Math.floor((w.weight / totalWeight) * winningsPool)
        : Math.floor(totalPool / winnersWithWeight.length);
      const share = isLast ? totalPool - distributed : rawShare;
      distributed += share;

      await tx.update(marketBets)
        .set({ status: "won", settledAt: now, payoutAmount: share })
        .where(eq(marketBets.id, w.id));

      const [updatedProfile] = await tx.update(profiles)
        .set({ predictCredits: sql`${profiles.predictCredits} + ${share}` })
        .where(eq(profiles.id, w.userId))
        .returning({ predictCredits: profiles.predictCredits });

      await tx.insert(creditLedger).values({
        userId: w.userId,
        txnType: "prediction_payout",
        amount: share,
        walletType: "VIRTUAL",
        balanceAfter: updatedProfile?.predictCredits ?? 0,
        source: "market_settlement",
        idempotencyKey: `jackpot_payout_${market.id}_${w.id}`,
        metadata: {
          marketId: market.id,
          betId: w.id,
          predictedScore: w.predictedScore,
          actualScore,
          margin: w.diff,
          payout: share,
          tiedWinners: winners.length,
        },
      }).onConflictDoNothing();
    }

    for (const loser of losers) {
      await tx.update(marketBets)
        .set({ status: "lost", settledAt: now, payoutAmount: 0 })
        .where(eq(marketBets.id, loser.id));
    }

    // Mark the single jackpot entry as resolved (consistent with settleMarketBets)
    await tx.update(marketEntries)
      .set({ resolutionStatus: "winner" })
      .where(eq(marketEntries.marketId, market.id));

    const winner = winners[0];
    await tx.update(predictionMarkets).set({
      status: "RESOLVED",
      resolvedAt: now,
      updatedAt: now,
      resolutionNotes: JSON.stringify({
        type: "jackpot",
        actualScore,
        winningPrediction: winner.predictedScore,
        winnerUserId: winners.length === 1 ? winner.userId : winners.map(w => w.userId),
        margin: winner.diff,
        totalPool,
        // Equal to totalPool now that the platform fee was removed
        // (Apr 2026). Field retained so older readers / admin dashboards
        // that key on `payout` keep working without conditional fallbacks.
        payout: totalPool,
        totalEntries: allBets.length,
        tiedWinners: winners.length,
        closeSnapshotAt: closeSnap?.capturedAt?.toISOString?.() ?? null,
      }),
    }).where(eq(predictionMarkets.id, market.id));
  });

  for (const w of winners) {
    try {
      await gamificationService.awardXp(
        w.userId, 'prediction_win',
        `prediction_win_${market.id}_${w.id}`,
        { marketId: market.id, betId: w.id }
      );
    } catch (e) { console.error("XP award for jackpot win failed:", e); }
    try {
      await checkAndAwardPredictionWinBadges(w.userId);
    } catch (e) { console.error("Jackpot win badge check failed:", e); }
  }

  // Notification fanout for jackpot. Same model as settleMarketBets but
  // here `winners` and `losers` are already known by reference; no need
  // to re-query market_bets. Idempotent on (marketId, betId).
  try {
    const href = `/markets/${market.slug ?? market.id}`;
    const marketTitle = market.title ?? "Jackpot prediction";
    const settledWinnerBets = await db
      .select({ id: marketBets.id, payoutAmount: marketBets.payoutAmount })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, market.id), eq(marketBets.status, "won")));
    const payoutById = new Map(settledWinnerBets.map(b => [b.id, b.payoutAmount ?? 0]));

    const resolvedDayBucket = notificationDayBucket();
    for (const w of winners) {
      const share = payoutById.get(w.id) ?? 0;
      const profit = share - w.stakeAmount;
      const { title, body } = buildJackpotResolvedWinNotification({
        marketTitle,
        actualScore,
        predictedScore: w.predictedScore,
        diff: w.diff,
        stake: w.stakeAmount,
        payout: share,
      });
      await createNotification({
        userId: w.userId,
        kind: "market_resolved",
        title,
        body,
        href,
        entityType: "market",
        entityId: market.id,
        marketId: market.id,
        metadata: { betId: w.id, status: "won", payout: share, stake: w.stakeAmount, profit, actualScore, predictedScore: w.predictedScore, margin: w.diff },
        groupKey: `market_resolved:${w.userId}:${resolvedDayBucket}`,
        idempotencyKey: `market_resolved:${market.id}:${w.id}`,
      });
    }
    for (const loser of losers) {
      const { title, body } = buildJackpotResolvedLossNotification({
        marketTitle,
        actualScore,
        stake: loser.stakeAmount,
      });
      await createNotification({
        userId: loser.userId,
        kind: "market_resolved",
        title,
        body,
        href,
        entityType: "market",
        entityId: market.id,
        marketId: market.id,
        metadata: { betId: loser.id, status: "lost", payout: 0, stake: loser.stakeAmount, profit: -loser.stakeAmount, actualScore },
        groupKey: `market_resolved:${loser.userId}:${resolvedDayBucket}`,
        idempotencyKey: `market_resolved:${market.id}:${loser.id}`,
      });
    }
  } catch (err) {
    log(`[Notifications] jackpot fanout failed for ${market.id}: ${(err as Error)?.message ?? err}`);
  }

  // Fire-and-forget resolution summary (jackpot settles outside settleMarketBets).
  generateResolutionSummary(market.id).catch(err =>
    log(`[ResolutionSummary] fire-and-forget failed for jackpot ${market.id}: ${err?.message ?? err}`)
  );

  const w = winners[0];
  log(`[MarketResolver] jackpot ${market.id}: resolved. actual=${actualScore}, winner predicted ${w.predictedScore} (off by ${w.diff}), pool=${totalPool}, entries=${allBets.length}, tied=${winners.length}`);
  return "resolved";
}

function isStaleBlockedLegacyMarket(market: any, now: Date): boolean {
  if (!market?.endAt) return false;
  const endedAt = ensureDate(market.endAt);
  if (!endedAt) return false;
  const ageMs = now.getTime() - endedAt.getTime();
  return ageMs >= LEGACY_BLOCK_AUTO_VOID_DAYS * 24 * 60 * 60 * 1000;
}

async function autoVoidBlockedLegacyMarket(market: any, now: Date): Promise<boolean> {
  if (!isStaleBlockedLegacyMarket(market, now)) return false;
  try {
    // AMM markets must void via the LMSR refund path (per-position cost
    // basis), not via voidMarketBets which assumes parimutuel stake-as-
    // refund semantics. A naive parimutuel refund on AMM rows would
    // double-credit users for any sells they made before the block.
    if (market?.engine === "amm") {
      const ammResult = await resolveAmmMarket({
        marketId: market.id,
        voidMarket: true,
        settledBy: null,
        voidReason: "amm_auto_void_stale",
      });
      if ("error" in ammResult) {
        log(`[MarketResolver] Failed AMM auto-void for stale blocked market ${market.id}: ${ammResult.error} ${ammResult.message}`);
        return false;
      }
      await db.update(predictionMarkets).set({
        resolveMethod: "auto",
        voidReason: "Auto-voided stale blocked AMM market",
        resolutionNotes: JSON.stringify(
          buildAmmResolutionNotes(
            {
              type: market.marketType,
              pendingReason: "auto_void_stale_blocked_legacy",
              thresholdDays: LEGACY_BLOCK_AUTO_VOID_DAYS,
            },
            "void_stale",
            ammResult,
          ),
        ),
        updatedAt: now,
      }).where(eq(predictionMarkets.id, market.id));
      log(`[MarketResolver] Auto-voided stale blocked AMM market ${market.id} (${market.marketType}), house P&L=${ammResult.creditedToHouse}`);
      return true;
    }

    await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      resolveMethod: "auto",
      voidReason: "Auto-voided stale blocked legacy market",
      resolutionNotes: JSON.stringify({
        type: market.marketType,
        pendingReason: "auto_void_stale_blocked_legacy",
        thresholdDays: LEGACY_BLOCK_AUTO_VOID_DAYS,
      }),
      updatedAt: now,
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] Auto-voided stale blocked market ${market.id} (${market.marketType})`);
    return true;
  } catch (err: any) {
    log(`[MarketResolver] Failed auto-void for stale blocked market ${market.id}: ${err?.message ?? err}`);
    return false;
  }
}

async function resolveExpiredMarketsOnce(): Promise<void> {
  try {
    const now = new Date();
    const expiredMarkets = await db
      .select()
      .from(predictionMarkets)
      .where(and(
        eq(predictionMarkets.status, "OPEN"),
        lte(predictionMarkets.endAt, now),
      ));

    _lastResolverRunAt = now;
    if (expiredMarkets.length === 0) {
      _resolverStats.lastRunAt = now.toISOString();
      _resolverStats.marketsFound = 0;
      return;
    }

    log(`[MarketResolver] Found ${expiredMarkets.length} expired market(s) to process`);

    let resolved = 0, voided = 0, pending = 0, skipped = 0, blocked = 0, errors = 0;

    for (const market of expiredMarkets) {
      try {
        let outcome: "resolved" | "voided" | "blocked" | null = null;
        switch (market.marketType) {
          case "updown":
            outcome = await resolveUpDownMarket(market);
            break;
          case "h2h":
            outcome = await resolveH2H(market);
            break;
          case "gainer":
            outcome = await resolveGainer(market);
            break;
          case "community": {
            // Expired UNPUBLISHED draft with zero financial state (never
            // seeded an AMM, no bets): archive silently instead of queuing
            // it for manual resolution. This keeps the settlement queue
            // clean when a founder reviews the daily scout drafts and only
            // publishes a couple. The row is retained (VOID + archived), so
            // its metadata.source.externalId still blocks the scout from
            // re-importing the same source event later.
            if (market.visibility === "draft" || market.visibility === "archived") {
              const [ammRow] = await db
                .select({ marketId: marketAmmState.marketId })
                .from(marketAmmState)
                .where(eq(marketAmmState.marketId, market.id))
                .limit(1);
              const [betRow] = await db
                .select({ id: marketBets.id })
                .from(marketBets)
                .where(eq(marketBets.marketId, market.id))
                .limit(1);
              if (!ammRow && !betRow) {
                await db.update(predictionMarkets).set({
                  status: "VOID",
                  visibility: "archived",
                  resolveMethod: "auto",
                  voidReason: "Draft expired unpublished",
                  resolutionNotes: JSON.stringify({
                    type: "community",
                    pendingReason: "draft_expired_unpublished_auto_archived",
                  }),
                  updatedAt: new Date(),
                }).where(eq(predictionMarkets.id, market.id));
                voided++;
                log(`[MarketResolver] Auto-archived expired unpublished draft ${market.id} (${market.slug})`);
                break;
              }
            }
            await db.update(predictionMarkets).set({
              status: "CLOSED_PENDING",
              resolutionNotes: JSON.stringify({
                type: "community",
                pendingReason: "community_requires_manual_resolution",
              }),
              updatedAt: new Date(),
            }).where(eq(predictionMarkets.id, market.id));
            pending++;
            // Instant ops ping: this market just entered the manual-resolution
            // queue. Fire-and-forget + idempotent (email_send_log keyed per
            // market), so it can never block or break the resolver loop.
            void (async () => {
              try {
                const { sendMarketNeedsResolutionAlert } = await import("./market-ops-digest");
                await sendMarketNeedsResolutionAlert({
                  id: market.id,
                  title: market.title,
                  slug: market.slug,
                  endAt: market.endAt,
                });
              } catch (alertErr: any) {
                log(`[MarketResolver] needs-resolution alert failed for ${market.id}: ${alertErr?.message ?? alertErr}`);
              }
            })();
            break;
          }
          case "jackpot":
            outcome = await resolveJackpot(market);
            break;
          default:
            log(`[MarketResolver] Unknown type '${market.marketType}' for market ${market.id}, skipping`);
            skipped++;
        }

        if (outcome === "resolved") {
          resolved++;
        } else if (outcome === "voided") {
          voided++;
        } else if (outcome === "blocked") {
          const autoVoided = await autoVoidBlockedLegacyMarket(market, now);
          if (autoVoided) voided++;
          else blocked++;
        }
      } catch (err: any) {
        log(`[MarketResolver] Error resolving ${market.marketType} market ${market.id}: ${err?.stack || err}`);
        errors++;
      }
    }

    _lastResolverRunAt = now;
    _resolverStats = {
      lastRunAt: now.toISOString(),
      marketsFound: expiredMarkets.length,
      resolved,
      voided,
      blocked,
      skipped,
      errors,
      pendingAdmin: pending,
    };

    log(`[MarketResolver] Done: ${resolved} resolved, ${voided} voided, ${pending} pending admin, ${blocked} blocked, ${skipped} skipped, ${errors} errors`);
  } catch (err) {
    log(`[MarketResolver] Scheduler error: ${err}`);
  }
}

export async function resolveExpiredMarkets(): Promise<void> {
  const locked = await withDbAdvisoryLock(
    MARKET_RESOLVER_LOCK_KEY,
    "MarketResolver",
    resolveExpiredMarketsOnce,
  );

  if (!locked.acquired) {
    log("[MarketResolver] Skipping run; another resolver instance holds the lock");
  }
}

export function startMarketResolverScheduler(): void {
  log("[MarketResolver] Starting scheduler (every 5 min, 2-min startup delay)");
  const safeResolve = () =>
    resolveExpiredMarkets().catch((err) =>
      console.error("[MarketResolver] Unhandled error in resolveExpiredMarkets:", err),
    );
  setTimeout(() => {
    safeResolve();
    setInterval(safeResolve, RESOLVER_INTERVAL_MS);
  }, RESOLVER_STARTUP_DELAY_MS);
}
