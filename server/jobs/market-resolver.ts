import { db, withDbAdvisoryLock } from "../db";
import { predictionMarkets, marketEntries, marketBets, trendSnapshots, profiles, creditLedger, trendingPeople } from "@shared/schema";
import { eq, and, sql, inArray, lte, gte, desc, asc } from "drizzle-orm";
import { log } from "../log";
import { calculateSettlementPayouts, computeEarlyBirdMultiplier } from "./settlement-utils";
import { scoreResolvedMarket } from "../agents/performanceUpdater";
import { getAiModel, getChatCompletionTokenLimit } from "../config/ai-models";
import { gamificationService } from "../services/gamification";
import { createNotification } from "../services/notifications";
import OpenAI from "openai";
import { fetchTrendingNewsContext } from "../providers/serper";

const RESOLVER_INTERVAL_MS = 5 * 60 * 1000;
const RESOLVER_STARTUP_DELAY_MS = 2 * 60 * 1000;
const SNAPSHOT_TOLERANCE_HOURS = 3;
const MARKET_RESOLVER_LOCK_KEY = 5_202;
const LEGACY_BLOCK_AUTO_VOID_DAYS = 14;

let _lastResolverRunAt: Date | null = null;
export function getLastResolverRunAt(): Date | null { return _lastResolverRunAt; }

interface SettlementResult {
  totalPool: number;
  winnersCount: number;
  losersCount: number;
  payoutsDistributed: number;
  remainder: number;
  remainderPolicy: 'burned';
  alreadySettled?: boolean;
}

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

export interface SettlementMeta {
  resolveMethod?: string;
  resolutionNotes?: string;
  settledBy?: string;
  voidReason?: string | null;
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
    // Only native markets — community markets use a different resolutionSummary
    // shape (synthesized object) on their detail endpoint.
    if (!["h2h", "updown", "gainer", "jackpot"].includes(market.marketType)) return;

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

    // For H2H / gainer / updown, try to anchor the summary in one headline
    // about the winning person. updown's "winner" is Up/Down (no person), so
    // we fall back to the market's linked personId in that case.
    let winningPersonId: string | null = winner.personId ?? null;
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
    // (it's JSON-stringified by the resolvers above).
    let marginLine = "";
    if (market.resolutionNotes) {
      try {
        const notes = JSON.parse(market.resolutionNotes);
        if (typeof notes?.percentChange === "string") {
          marginLine = `Margin: ${notes.percentChange}.`;
        } else if (Array.isArray(notes?.rankings) && notes.rankings[0]?.pctChange) {
          marginLine = `Winning gain: ${notes.rankings[0].pctChange}.`;
        }
      } catch {}
    }

    const marketTypeLabel = market.marketType === "h2h"
      ? "head-to-head"
      : market.marketType === "gainer"
        ? "top-gainer"
        : market.marketType === "updown"
          ? "up/down"
          : market.marketType;

    const systemPrompt = `You write one-sentence neutral summaries for resolved prediction markets, in the style of a wire-service headline. Past tense. No opinions. No hype words (never use: backlash, scandal, controversy, embattled, slammed, blasted, divisive, polarizing). If a headline is provided, you may reference its event only as a factual anchor — never characterize public reaction.`;

    const userPrompt = `Write ONE sentence (max 25 words) summarising this resolved ${marketTypeLabel} prediction market.

Market title: ${market.title}
Winner: ${winner.label}${winningPersonName && winningPersonName !== winner.label ? ` (${winningPersonName})` : ""}
${loser ? `Loser: ${loser.label}` : ""}
${marginLine}
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

export async function settleMarketBets(marketId: string, winnerEntryId: string, meta?: SettlementMeta): Promise<SettlementResult> {
  const result = await db.transaction(async (tx) => {
    const now = new Date();

    const [winnerEntry] = await tx
      .select({ id: marketEntries.id })
      .from(marketEntries)
      .where(and(eq(marketEntries.id, winnerEntryId), eq(marketEntries.marketId, marketId)));
    if (!winnerEntry) {
      throw new Error(`Entry ${winnerEntryId} does not belong to market ${marketId}`);
    }

    const claimed = await tx
      .update(predictionMarkets)
      .set({
        status: "RESOLVED",
        resolvedAt: now,
        updatedAt: now,
        ...(meta?.resolveMethod && { resolveMethod: meta.resolveMethod }),
        ...(meta?.resolutionNotes && { resolutionNotes: meta.resolutionNotes }),
        ...(meta?.settledBy && { settledBy: meta.settledBy }),
        ...(meta?.voidReason !== undefined && { voidReason: meta.voidReason }),
      })
      .where(and(
        eq(predictionMarkets.id, marketId),
        sql`${predictionMarkets.status} NOT IN ('RESOLVED', 'VOID')`
      ))
      .returning({ id: predictionMarkets.id });

    if (claimed.length === 0) {
      return {
        totalPool: 0,
        winnersCount: 0,
        losersCount: 0,
        payoutsDistributed: 0,
        remainder: 0,
        remainderPolicy: 'burned' as const,
        alreadySettled: true,
      };
    }

    const allBets = await tx
      .select({
        id: marketBets.id,
        entryId: marketBets.entryId,
        userId: marketBets.userId,
        stakeAmount: marketBets.stakeAmount,
        direction: marketBets.direction,
        createdAt: marketBets.createdAt,
      })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "active")));

    if (allBets.length === 0) {
      await tx.update(marketEntries)
        .set({ resolutionStatus: "winner" })
        .where(eq(marketEntries.id, winnerEntryId));
      await tx.update(marketEntries)
        .set({ resolutionStatus: "loser" })
        .where(and(eq(marketEntries.marketId, marketId), sql`${marketEntries.id} != ${winnerEntryId}`));

      return {
        totalPool: 0,
        winnersCount: 0,
        losersCount: 0,
        payoutsDistributed: 0,
        remainder: 0,
        remainderPolicy: 'burned' as const,
      };
    }

    const [marketTiming] = await tx
      .select({ startAt: predictionMarkets.startAt, closeAt: predictionMarkets.closeAt })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, marketId))
      .limit(1);

    const preview = calculateSettlementPayouts(
      allBets.map(b => ({ ...b, direction: b.direction as "yes" | "no", createdAt: b.createdAt })),
      winnerEntryId,
      { marketStartAt: marketTiming?.startAt, marketCloseAt: marketTiming?.closeAt },
    );
    const payoutByBetId = new Map(preview.payouts.map((entry) => [entry.betId, entry.payout]));

    const isWinningBet = (bet: typeof allBets[0]) => {
      const dir = bet.direction || "yes";
      return (dir === "yes" && bet.entryId === winnerEntryId) ||
             (dir === "no" && bet.entryId !== winnerEntryId);
    };

    for (const bet of allBets) {
      if (isWinningBet(bet)) {
        const payout = payoutByBetId.get(bet.id) ?? bet.stakeAmount;
        await tx.update(marketBets)
          .set({ status: "won", settledAt: now, payoutAmount: payout })
          .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));

        const [updatedProfile] = await tx.update(profiles)
          .set({ predictCredits: sql`${profiles.predictCredits} + ${payout}` })
          .where(eq(profiles.id, bet.userId))
          .returning({ predictCredits: profiles.predictCredits });

        await tx.insert(creditLedger).values({
          userId: bet.userId,
          txnType: 'prediction_payout',
          amount: payout,
          walletType: 'VIRTUAL',
          balanceAfter: updatedProfile?.predictCredits ?? 0,
          source: 'market_settlement',
          idempotencyKey: `payout_${marketId}_${bet.id}`,
          metadata: { marketId, entryId: bet.entryId, betId: bet.id, stakeAmount: bet.stakeAmount, payout },
        }).onConflictDoNothing();
      } else {
        await tx.update(marketBets)
          .set({ status: "lost", settledAt: now, payoutAmount: 0 })
          .where(and(eq(marketBets.id, bet.id), eq(marketBets.status, "active")));
      }
    }

    await tx.update(marketEntries)
      .set({ resolutionStatus: "winner" })
      .where(eq(marketEntries.id, winnerEntryId));
    await tx.update(marketEntries)
      .set({ resolutionStatus: "loser" })
      .where(and(eq(marketEntries.marketId, marketId), sql`${marketEntries.id} != ${winnerEntryId}`));

    const uniqueUserIds = Array.from(new Set(allBets.map(b => b.userId)));
    for (const userId of uniqueUserIds) {
      const resolvedBets = await tx
        .select({ status: marketBets.status, settledAt: marketBets.settledAt })
        .from(marketBets)
        .where(and(
          eq(marketBets.userId, userId),
          sql`${marketBets.status} IN ('won', 'lost')`,
        ));

      const wonCount = resolvedBets.filter(b => b.status === 'won').length;
      const totalResolved = resolvedBets.length;
      const winRate = totalResolved > 0
        ? Math.round((wonCount / totalResolved) * 1000) / 10
        : 0;

      const sortedDesc = resolvedBets
        .filter(b => b.settledAt != null)
        .sort((a, b) => new Date(b.settledAt!).getTime() - new Date(a.settledAt!).getTime());

      let currentStreak = 0;
      for (const bet of sortedDesc) {
        if (bet.status === 'won') currentStreak++;
        else break;
      }

      await tx.update(profiles)
        .set({ winRate, currentStreak })
        .where(eq(profiles.id, userId));
    }

    return {
      totalPool: preview.totalPool,
      winnersCount: preview.winnerBets.length,
      losersCount: allBets.length - preview.winnerBets.length,
      payoutsDistributed: preview.payoutsDistributed,
      remainder: preview.remainder,
      remainderPolicy: 'burned' as const,
    };
  });

  const remainder = result.totalPool - result.payoutsDistributed;
  if (Math.abs(remainder) > 1) {
    console.log(`[PAYOUT REMAINDER LARGE] marketId=${marketId} remainder=${remainder} pool=${result.totalPool} winners=${result.winnersCount}`);
  }
  log(`[MarketResolver] Settlement: market=${marketId}, pool=${result.totalPool}, payouts=${result.payoutsDistributed}, remainder=${remainder} (burned), winners=${result.winnersCount}, losers=${result.losersCount}`);

  if (!result.alreadySettled && result.winnersCount > 0) {
    const winnerBets = await db.select({ userId: marketBets.userId, id: marketBets.id })
      .from(marketBets)
      .where(and(eq(marketBets.marketId, marketId), eq(marketBets.status, "won")));

    for (const bet of winnerBets) {
      try {
        await gamificationService.awardXp(
          bet.userId, 'prediction_win',
          `prediction_win_${marketId}_${bet.id}`,
          { marketId, betId: bet.id }
        );
      } catch (e) { console.error("XP award for prediction win failed:", e); }
    }
  }

  // Notification fanout: one row per affected user. Winners and losers
  // both get a `market_resolved` notification — a "you lost" ping is far
  // less spammy than it sounds and lets users close the loop on their
  // open positions instead of repeatedly checking /me/predictions.
  // Idempotency uses (marketId, betId) so re-runs of settleMarketBets
  // (e.g. retries after a transient error) silently absorb.
  if (!result.alreadySettled) {
    try {
      const settledBets = await db
        .select({
          id: marketBets.id,
          userId: marketBets.userId,
          status: marketBets.status,
          payoutAmount: marketBets.payoutAmount,
          stakeAmount: marketBets.stakeAmount,
        })
        .from(marketBets)
        .where(and(
          eq(marketBets.marketId, marketId),
          inArray(marketBets.status, ["won", "lost"]),
        ));

      const [marketMeta] = await db
        .select({ title: predictionMarkets.title, slug: predictionMarkets.slug })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.id, marketId));

      const marketTitle = marketMeta?.title ?? "your prediction";
      const href = marketMeta?.slug ? `/markets/${marketMeta.slug}` : `/me/predictions`;

      for (const bet of settledBets) {
        const won = bet.status === "won";
        const payout = bet.payoutAmount ?? 0;
        const profit = won ? payout - bet.stakeAmount : -bet.stakeAmount;
        // Title and body are split by sign of profit so a "won" with
        // profit=0 (only one bet on the winning entry, payout equals
        // stake) doesn't read like a celebratory windfall. Body always
        // names the title, the payout, and the signed net so the row
        // and the result page agree once the user clicks through.
        const signedProfit = `${profit >= 0 ? "+" : ""}${profit.toLocaleString("en-US")}`;
        let title: string;
        let body: string;
        if (won && profit > 0) {
          title = `Your prediction won — ${signedProfit} credits`;
          body = `${marketTitle} resolved. Payout ${payout.toLocaleString("en-US")} credits (net ${signedProfit}).`;
        } else if (won) {
          title = `Stake returned — ${payout.toLocaleString("en-US")} credits`;
          body = `${marketTitle} resolved. Payout matched your stake (net ${signedProfit}).`;
        } else {
          title = `Your prediction didn't land`;
          body = `${marketTitle} resolved. Lost ${bet.stakeAmount.toLocaleString("en-US")} credits — better luck next round.`;
        }
        await createNotification({
          userId: bet.userId,
          kind: "market_resolved",
          title,
          body,
          href,
          entityType: "market",
          entityId: marketId,
          marketId,
          metadata: { betId: bet.id, status: bet.status, payout, stake: bet.stakeAmount, profit },
          idempotencyKey: `market_resolved:${marketId}:${bet.id}`,
        });
      }
    } catch (err) {
      log(`[Notifications] settleMarketBets fanout failed for ${marketId}: ${(err as Error)?.message ?? err}`);
    }
  }

  // Fire-and-forget AI resolution summary. Never block settlement on it.
  if (!result.alreadySettled) {
    generateResolutionSummary(marketId).catch(err =>
      log(`[ResolutionSummary] fire-and-forget failed for ${marketId}: ${err?.message ?? err}`)
    );
  }

  return result;
}

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
          idempotencyKey: `market_void_refund:${marketId}:${bet.id}`,
        });
      }
    } catch (err) {
      log(`[Notifications] voidMarketBets fanout failed for ${marketId}: ${(err as Error)?.message ?? err}`);
    }
  }

  return refundedCount;
}

function ensureDate(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (val == null) return null;
  const d = new Date(val as string | number);
  if (isNaN(d.getTime())) return null;
  return d;
}

function getStoredOpeningScore(market: any, personId: string): { score: number; capturedAt: Date } | null {
  const meta = market.metadata;
  if (!meta) return null;

  if (meta.openingScore && meta.openingScore.personId === personId) {
    const capturedAt = ensureDate(meta.openingScore.snapshotAt);
    if (!capturedAt) return null;
    return { score: meta.openingScore.score, capturedAt };
  }

  if (Array.isArray(meta.openingScores)) {
    const match = meta.openingScores.find((s: any) => s.personId === personId);
    if (match) {
      const capturedAt = ensureDate(match.snapshotAt);
      if (!capturedAt) return null;
      return { score: match.score, capturedAt };
    }
  }

  return null;
}

async function findSnapshotScore(personId: string, rawTargetTime: Date | string, direction: "before" | "after"): Promise<{ score: number; capturedAt: Date } | null> {
  const targetTime = ensureDate(rawTargetTime);
  if (!targetTime) return null;
  const toleranceMs = SNAPSHOT_TOLERANCE_HOURS * 60 * 60 * 1000;

  if (direction === "before") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        lte(trendSnapshots.timestamp, targetTime),
        gte(trendSnapshots.timestamp, new Date(targetTime.getTime() - toleranceMs)),
      ))
      .orderBy(desc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
    }
  }

  if (direction === "after") {
    const rows = await db
      .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
      .from(trendSnapshots)
      .where(and(
        eq(trendSnapshots.personId, personId),
        gte(trendSnapshots.timestamp, targetTime),
        lte(trendSnapshots.timestamp, new Date(targetTime.getTime() + 60 * 60 * 1000)),
      ))
      .orderBy(asc(trendSnapshots.timestamp))
      .limit(1);
    if (rows.length > 0 && rows[0].fameIndex != null) {
      return { score: rows[0].fameIndex, capturedAt: ensureDate(rows[0].timestamp)! };
    }
  }

  return null;
}

async function getCloseSnapshot(personId: string, endAt: Date): Promise<{ score: number; capturedAt: Date } | null> {
  return (await findSnapshotScore(personId, endAt, "before"))
    ?? (await findSnapshotScore(personId, endAt, "after"));
}

async function getOpenSnapshot(personId: string, rawStartAt: Date | string, market: any): Promise<{ score: number; capturedAt: Date } | null> {
  const stored = getStoredOpeningScore(market, personId);
  if (stored) return stored;

  const startAt = ensureDate(rawStartAt);
  if (!startAt) return null;
  const result = (await findSnapshotScore(personId, startAt, "after"))
    ?? (await findSnapshotScore(personId, startAt, "before"));
  if (result) return result;

  const hasMetadataScores = market.metadata?.openingScore || market.metadata?.openingScores;
  if (hasMetadataScores) {
    return null;
  }

  log(`[MarketResolver] Using wide-tolerance fallback for legacy market ${market.id}`);
  const wideRows = await db
    .select({ fameIndex: trendSnapshots.fameIndex, timestamp: trendSnapshots.timestamp })
    .from(trendSnapshots)
    .where(and(
      eq(trendSnapshots.personId, personId),
      gte(trendSnapshots.timestamp, new Date(startAt.getTime() - 7 * 24 * 60 * 60 * 1000)),
      lte(trendSnapshots.timestamp, new Date(startAt.getTime() + 24 * 60 * 60 * 1000)),
    ))
    .orderBy(sql`ABS(EXTRACT(EPOCH FROM ${trendSnapshots.timestamp} - ${startAt}::timestamp))`)
    .limit(1);
  if (wideRows.length > 0 && wideRows[0].fameIndex != null) {
    return { score: wideRows[0].fameIndex, capturedAt: ensureDate(wideRows[0].timestamp)! };
  }
  return null;
}

async function resolveUpDown(market: any): Promise<"resolved" | "voided" | "blocked"> {
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
  const closeSnap = await getCloseSnapshot(personId, market.endAt);
  if (!openSnap || !closeSnap) {
    log(`[MarketResolver] updown ${market.id}: missing snapshots (open=${!!openSnap}, close=${!!closeSnap}), marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const evidence = {
    type: "updown",
    personId,
    openScore: openSnap.score,
    openSnapshotAt: openSnap.capturedAt.toISOString(),
    closeScore: closeSnap.score,
    closeSnapshotAt: closeSnap.capturedAt.toISOString(),
    change: closeSnap.score - openSnap.score,
    percentChange: openSnap.score > 0 ? ((closeSnap.score - openSnap.score) / openSnap.score * 100).toFixed(2) + "%" : "N/A",
  };

  if (closeSnap.score === openSnap.score) {
    const tieRule = market.tieRule || "refund";
    if (tieRule === "up_wins" || tieRule === "down_wins") {
      const tieWinnerId = tieRule === "up_wins" ? upEntry.id : downEntry.id;
      const tieWinnerLabel = tieRule === "up_wins" ? "Up" : "Down";
      const result = await settleMarketBets(market.id, tieWinnerId, {
        resolveMethod: "auto",
        resolutionNotes: JSON.stringify({ ...evidence, outcome: tieWinnerLabel, tieRule }),
      });
      log(`[MarketResolver] updown ${market.id}: tie resolved by tieRule=${tieRule}, ${tieWinnerLabel} wins, pool=${result.totalPool}`);
      scoreResolvedMarket(market.id, tieWinnerId).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));
      return "resolved";
    }
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — score unchanged",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie", tieRule }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] updown ${market.id}: VOID (tie), ${refunded} bets refunded`);
    return "voided";
  }

  const winnerId = closeSnap.score > openSnap.score ? upEntry.id : downEntry.id;
  const winnerLabel = closeSnap.score > openSnap.score ? "Up" : "Down";
  const result = await settleMarketBets(market.id, winnerId, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winnerLabel }),
  });

  scoreResolvedMarket(market.id, winnerId).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] updown ${market.id}: ${winnerLabel} wins (${openSnap.score} → ${closeSnap.score}), pool=${result.totalPool}, winners=${result.winnersCount}`);
  return "resolved";
}

async function resolveH2H(market: any): Promise<"resolved" | "voided" | "blocked"> {
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

  const closeA = await getCloseSnapshot(entryA.personId, market.endAt);
  const closeB = await getCloseSnapshot(entryB.personId, market.endAt);
  if (!closeA || !closeB) {
    log(`[MarketResolver] h2h ${market.id}: missing close snapshots, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  const evidence = {
    type: "h2h",
    entryA: { personId: entryA.personId, label: entryA.label, score: closeA.score, snapshotAt: closeA.capturedAt.toISOString() },
    entryB: { personId: entryB.personId, label: entryB.label, score: closeB.score, snapshotAt: closeB.capturedAt.toISOString() },
  };

  if (closeA.score === closeB.score) {
    const tieRule = market.tieRule || "refund";
    if (tieRule === "up_wins" || tieRule === "down_wins") {
      const tieWinner = tieRule === "up_wins" ? entryA : entryB;
      const result = await settleMarketBets(market.id, tieWinner.id, {
        resolveMethod: "auto",
        resolutionNotes: JSON.stringify({ ...evidence, outcome: tieWinner.label, tieRule }),
      });
      log(`[MarketResolver] h2h ${market.id}: tie resolved by tieRule=${tieRule}, ${tieWinner.label} wins, pool=${result.totalPool}`);
      scoreResolvedMarket(market.id, tieWinner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));
      return "resolved";
    }
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — identical scores",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie", tieRule }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] h2h ${market.id}: VOID (tie at ${closeA.score}), ${refunded} bets refunded`);
    return "voided";
  }

  const winner = closeA.score > closeB.score ? entryA : entryB;
  const result = await settleMarketBets(market.id, winner.id, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label }),
  });

  scoreResolvedMarket(market.id, winner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] h2h ${market.id}: ${winner.label} wins (${closeA.score} vs ${closeB.score}), pool=${result.totalPool}`);
  return "resolved";
}

async function resolveGainer(market: any): Promise<"resolved" | "voided" | "blocked"> {
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

  const gains: { entry: typeof entries[0]; openScore: number; closeScore: number; pctChange: number }[] = [];

  for (const entry of entriesWithPersonId) {
    const openSnap = await getOpenSnapshot(entry.personId!, market.startAt, market);
    const closeSnap = await getCloseSnapshot(entry.personId!, market.endAt);
    if (!openSnap || !closeSnap) continue;
    const pctChange = openSnap.score > 0 ? ((closeSnap.score - openSnap.score) / openSnap.score) * 100 : 0;
    gains.push({ entry, openScore: openSnap.score, closeScore: closeSnap.score, pctChange });
  }

  if (gains.length === 0) {
    log(`[MarketResolver] gainer ${market.id}: no valid snapshots for any entry, marking blocked`);
    await db.update(predictionMarkets).set({ resolutionNotes: "Auto-resolution blocked: missing snapshot data", updatedAt: new Date() }).where(eq(predictionMarkets.id, market.id));
    return "blocked";
  }

  gains.sort((a, b) => b.pctChange - a.pctChange);

  const evidence = {
    type: "gainer",
    rankings: gains.map(g => ({
      personId: g.entry.personId,
      label: g.entry.label,
      openScore: g.openScore,
      closeScore: g.closeScore,
      pctChange: g.pctChange.toFixed(2) + "%",
    })),
  };

  if (gains.length >= 2 && Math.abs(gains[0].pctChange - gains[1].pctChange) < 0.001) {
    const refunded = await voidMarketBets(market.id);
    await db.update(predictionMarkets).set({
      status: "VOID",
      resolvedAt: new Date(),
      resolveMethod: "auto",
      voidReason: "Tie — identical top gain percentage",
      resolutionNotes: JSON.stringify({ ...evidence, outcome: "void_tie" }),
      updatedAt: new Date(),
    }).where(eq(predictionMarkets.id, market.id));
    log(`[MarketResolver] gainer ${market.id}: VOID (tied at ${gains[0].pctChange.toFixed(2)}%), ${refunded} bets refunded`);
    return "voided";
  }

  const winner = gains[0].entry;
  const result = await settleMarketBets(market.id, winner.id, {
    resolveMethod: "auto",
    resolutionNotes: JSON.stringify({ ...evidence, outcome: winner.label }),
  });

  scoreResolvedMarket(market.id, winner.id).catch(e => log(`[MarketResolver] Agent scoring failed: ${e}`));

  log(`[MarketResolver] gainer ${market.id}: ${winner.label} wins (+${gains[0].pctChange.toFixed(2)}%), pool=${result.totalPool}`);
  return "resolved";
}

async function resolveJackpot(market: any): Promise<"resolved" | "blocked"> {
  const personId = market.personId;
  if (!personId) {
    log(`[MarketResolver] jackpot ${market.id}: no personId, skipping`);
    return "blocked";
  }

  const closeSnap = await getCloseSnapshot(personId, market.endAt);
  if (!closeSnap) {
    log(`[MarketResolver] jackpot ${market.id}: no snapshot available yet, will retry`);
    return "blocked";
  }

  const actualScore = Math.round(closeSnap.score);

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
        closeSnapshotAt: closeSnap.capturedAt?.toISOString?.() ?? null,
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

    for (const w of winners) {
      const share = payoutById.get(w.id) ?? 0;
      const profit = share - w.stakeAmount;
      const signedProfit = `${profit >= 0 ? "+" : ""}${profit.toLocaleString("en-US")}`;
      const title = profit > 0
        ? `Jackpot win — ${signedProfit} credits`
        : `Jackpot — stake returned (${share.toLocaleString("en-US")} credits)`;
      await createNotification({
        userId: w.userId,
        kind: "market_resolved",
        title,
        body: `${marketTitle} closed at ${actualScore}. You predicted ${w.predictedScore} (off by ${w.diff}). Payout ${share.toLocaleString("en-US")} (net ${signedProfit}).`,
        href,
        entityType: "market",
        entityId: market.id,
        marketId: market.id,
        metadata: { betId: w.id, status: "won", payout: share, stake: w.stakeAmount, profit, actualScore, predictedScore: w.predictedScore, margin: w.diff },
        idempotencyKey: `market_resolved:${market.id}:${w.id}`,
      });
    }
    for (const loser of losers) {
      await createNotification({
        userId: loser.userId,
        kind: "market_resolved",
        title: `Jackpot didn't land`,
        body: `${marketTitle} closed at ${actualScore}. Lost ${loser.stakeAmount.toLocaleString("en-US")} credits.`,
        href,
        entityType: "market",
        entityId: market.id,
        marketId: market.id,
        metadata: { betId: loser.id, status: "lost", payout: 0, stake: loser.stakeAmount, profit: -loser.stakeAmount, actualScore },
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
            outcome = await resolveUpDown(market);
            break;
          case "h2h":
            outcome = await resolveH2H(market);
            break;
          case "gainer":
            outcome = await resolveGainer(market);
            break;
          case "community":
            await db.update(predictionMarkets).set({
              status: "CLOSED_PENDING",
              resolutionNotes: JSON.stringify({
                type: "community",
                pendingReason: "community_requires_manual_resolution",
              }),
              updatedAt: new Date(),
            }).where(eq(predictionMarkets.id, market.id));
            pending++;
            break;
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
