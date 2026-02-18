import { db } from "../db";
import { predictionMarkets, marketEntries } from "../../shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

interface SeedConfig {
  participants?: number;
  poolTarget?: number;
  upBias?: number;
  distributionShape?: "front-loaded" | "uniform" | "bell-curve";
  batchesCompleted?: number;
  totalBatches?: number;
  lastSeededAt?: string;
}

const TOTAL_SEED_BATCHES = 40;
const SEED_WINDOW_START_HOUR = 6;
const SEED_WINDOW_END_HOUR = 22;
const SEED_WINDOW_START_DAY = 1;
const SEED_WINDOW_END_DAY = 2;

const DEFAULT_LIMIT_MARKETS = 25;
const DEFAULT_MAX_RUNTIME_MS = 8000;
const SEED_COOLDOWN_MS = 30 * 60 * 1000;

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function bellCurveWeight(batchIndex: number, total: number): number {
  const mean = total / 2;
  const sigma = total / 4;
  return Math.exp(-0.5 * Math.pow((batchIndex - mean) / sigma, 2));
}

function frontLoadedWeight(batchIndex: number, total: number): number {
  return Math.max(0.1, 1 - (batchIndex / total) * 0.8);
}

function getBatchWeight(batchIndex: number, total: number, shape: string): number {
  switch (shape) {
    case "bell-curve": return bellCurveWeight(batchIndex, total);
    case "front-loaded": return frontLoadedWeight(batchIndex, total);
    default: return 1;
  }
}

function jitter(value: number, range: number = 0.2): number {
  return Math.round(value * (1 + (Math.random() * 2 - 1) * range));
}

function generateSeedBets(
  entries: any[],
  batchCredits: number,
  bias: number,
  marketType: string
): { entryId: string; amount: number }[] {
  const bets: { entryId: string; amount: number }[] = [];

  if ((marketType === "updown" || marketType === "jackpot") && entries.length === 2) {
    const upEntry = entries.find(e => e.label?.toLowerCase() === "up");
    const downEntry = entries.find(e => e.label?.toLowerCase() === "down");
    if (!upEntry || !downEntry) return bets;
    const upAmount = Math.round(batchCredits * (bias / 100));
    const downAmount = batchCredits - upAmount;
    if (upAmount > 0) bets.push({ entryId: upEntry.id, amount: jitter(upAmount, 0.15) });
    if (downAmount > 0) bets.push({ entryId: downEntry.id, amount: jitter(downAmount, 0.15) });
  } else if (marketType === "h2h" && entries.length === 2) {
    const e1Amount = Math.round(batchCredits * (bias / 100));
    const e2Amount = batchCredits - e1Amount;
    if (e1Amount > 0) bets.push({ entryId: entries[0].id, amount: jitter(e1Amount, 0.15) });
    if (e2Amount > 0) bets.push({ entryId: entries[1].id, amount: jitter(e2Amount, 0.15) });
  } else if (marketType === "gainer" && entries.length > 0) {
    let remaining = batchCredits;
    const weights = entries.map((_, i) => Math.max(0.05, 1 - i * 0.15));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < entries.length; i++) {
      const share = Math.round(batchCredits * (weights[i] / totalWeight));
      const amount = Math.min(share, remaining);
      if (amount > 0) {
        bets.push({ entryId: entries[i].id, amount: jitter(amount, 0.2) });
        remaining -= amount;
      }
    }
  }

  return bets.filter(b => b.amount > 0);
}

export interface SeedBatchResult {
  processed: number;
  skipped: number;
  skippedCooldown: number;
  skippedComplete: number;
  totalCreditsDistributed: number;
  runtimeMs: number;
  stoppedEarly: boolean;
}

export async function runSeedBatch(
  force = false,
  limitMarkets = DEFAULT_LIMIT_MARKETS,
  maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS
): Promise<SeedBatchResult> {
  const startTime = Date.now();
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const hour = now.getUTCHours();

  if (!force) {
    if (dayOfWeek < SEED_WINDOW_START_DAY || dayOfWeek > SEED_WINDOW_END_DAY) {
      return { processed: 0, skipped: 0, skippedCooldown: 0, skippedComplete: 0, totalCreditsDistributed: 0, runtimeMs: 0, stoppedEarly: false };
    }
    if (hour < SEED_WINDOW_START_HOUR || hour > SEED_WINDOW_END_HOUR) {
      return { processed: 0, skipped: 0, skippedCooldown: 0, skippedComplete: 0, totalCreditsDistributed: 0, runtimeMs: 0, stoppedEarly: false };
    }
  }

  const currentWeek = getISOWeekNumber(now);

  const markets = await db.select()
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        inArray(predictionMarkets.marketType, ["updown", "h2h", "gainer"]),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
        eq(predictionMarkets.weekNumber, currentWeek)
      )
    );

  if (markets.length === 0) {
    return { processed: 0, skipped: 0, skippedCooldown: 0, skippedComplete: 0, totalCreditsDistributed: 0, runtimeMs: Date.now() - startTime, stoppedEarly: false };
  }

  const marketIds = markets.map(m => m.id);
  const allEntries = await db.select()
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, marketIds));

  let processed = 0;
  let skipped = 0;
  let skippedCooldown = 0;
  let skippedComplete = 0;
  let totalCreditsDistributed = 0;
  let stoppedEarly = false;

  const shuffled = [...markets].sort(() => Math.random() - 0.5);

  for (const market of shuffled) {
    if (Date.now() - startTime > maxRuntimeMs) {
      stoppedEarly = true;
      break;
    }

    if (processed >= limitMarkets) {
      stoppedEarly = true;
      break;
    }

    const config: SeedConfig = (market.seedConfig as SeedConfig) || {};
    const batchesCompleted = config.batchesCompleted || 0;
    const totalBatches = config.totalBatches || TOTAL_SEED_BATCHES;

    if (batchesCompleted >= totalBatches) {
      skippedComplete++;
      skipped++;
      continue;
    }

    if (config.lastSeededAt) {
      const lastSeeded = new Date(config.lastSeededAt).getTime();
      if (now.getTime() - lastSeeded < SEED_COOLDOWN_MS) {
        skippedCooldown++;
        skipped++;
        continue;
      }
    }

    const poolTarget = config.poolTarget || getDefaultPoolTarget(market.marketType);
    const upBias = config.upBias ?? 55;
    const shape = config.distributionShape || "bell-curve";

    const weight = getBatchWeight(batchesCompleted, totalBatches, shape);
    const totalWeights = Array.from({ length: totalBatches }, (_, i) => getBatchWeight(i, totalBatches, shape));
    const sumWeights = totalWeights.reduce((a, b) => a + b, 0);
    const batchCredits = Math.round((poolTarget * weight) / sumWeights);

    const entries = allEntries.filter(e => e.marketId === market.id);
    if (entries.length === 0) {
      skipped++;
      continue;
    }

    const bets = generateSeedBets(entries, batchCredits, upBias, market.marketType);

    for (const bet of bets) {
      await db.update(marketEntries)
        .set({
          totalStake: sql`COALESCE(${marketEntries.totalStake}, 0) + ${bet.amount}`,
        })
        .where(eq(marketEntries.id, bet.entryId));
      totalCreditsDistributed += bet.amount;
    }

    const currentVolume = Number(market.seedVolume || 0);
    const batchTotal = bets.reduce((s, b) => s + b.amount, 0);
    const participants = config.participants || getDefaultParticipants(market.marketType);
    const newParticipants = Math.round(participants * (weight / sumWeights) * (0.8 + Math.random() * 0.4));

    await db.update(predictionMarkets)
      .set({
        seedVolume: String(currentVolume + batchTotal),
        seedConfig: {
          ...config,
          batchesCompleted: batchesCompleted + 1,
          participants: (config.participants || 0) + newParticipants,
          lastSeededAt: now.toISOString(),
        },
      })
      .where(eq(predictionMarkets.id, market.id));

    processed++;
  }

  return {
    processed,
    skipped,
    skippedCooldown,
    skippedComplete,
    totalCreditsDistributed,
    runtimeMs: Date.now() - startTime,
    stoppedEarly,
  };
}

function getDefaultPoolTarget(marketType: string): number {
  switch (marketType) {
    case "updown": return 5000 + Math.round(Math.random() * 3000);
    case "h2h": return 15000 + Math.round(Math.random() * 10000);
    case "gainer": return 12000 + Math.round(Math.random() * 8000);
    case "jackpot": return 3000 + Math.round(Math.random() * 2000);
    default: return 8000;
  }
}

function getDefaultParticipants(marketType: string): number {
  switch (marketType) {
    case "updown": return 50 + Math.round(Math.random() * 30);
    case "h2h": return 80 + Math.round(Math.random() * 40);
    case "gainer": return 60 + Math.round(Math.random() * 30);
    case "jackpot": return 20 + Math.round(Math.random() * 15);
    default: return 50;
  }
}
