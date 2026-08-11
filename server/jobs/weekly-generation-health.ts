/**
 * Post-generation health check for the weekly native market batch.
 *
 * --------------------------------------------------------------------------
 * The gap this closes
 * --------------------------------------------------------------------------
 * `generateAllWeeklyMarkets` only alerted when the week produced ZERO native
 * markets across all four types. With four independent generators that is a
 * condition production will essentially never reach, so the alert never fired.
 *
 * The realistic failure is a PARTIAL week: a generator throws halfway, or the
 * house runs out of credits mid-batch, and the week opens with 12 Up/Down
 * cards instead of 20. That was invisible, and worse, unrecoverable — the
 * Monday freeze in each generator skips the whole type when ANY open market
 * exists for it, and `decideMissingMarketTypes` only treats a type as missing
 * at a count of exactly 0. A short type is therefore never backfilled, so the
 * week stays short until the next Monday. Nobody found out.
 *
 * --------------------------------------------------------------------------
 * Why the expectations are derived two different ways
 * --------------------------------------------------------------------------
 * Up/Down and Jackpot both draw the anchored weekly field, so their expected
 * count is exactly `ANCHORED_FIELD_SIZE`. Deriving it from that constant
 * rather than hardcoding 20 means changing the field composition can't leave a
 * stale threshold behind alerting on every week.
 *
 * H2H and Gainer are per-category (2 pairings and 1 race per eligible
 * category), so their counts move whenever the roster's category mix moves —
 * a hardcoded number would false-alarm the first time a category was added or
 * lost an eligible entrant. Those use the max count seen over the trailing 4
 * weeks instead, which self-calibrates. Trailing MAX, not average: after one
 * bad week an average would quietly ratchet the expectation down and stop
 * alerting, which is precisely the failure being watched for.
 *
 * Measured weeks 24–33 (10 consecutive weeks): 20 / 20 / 9 / 20 with zero
 * variance, so neither basis should produce noise. Note Gainer is 9, not one
 * per category — a category short of `GAINER_MIN_ELIGIBLE` produces no race.
 *
 * --------------------------------------------------------------------------
 * Deliberately advisory
 * --------------------------------------------------------------------------
 * This never throws and never blocks generation. A shortfall alert that broke
 * the generator it monitors would be worse than the blind spot it replaces.
 */

import { and, eq, gte, lt, inArray, sql } from "drizzle-orm";
import { predictionMarkets } from "@shared/schema";
import { ANCHORED_FIELD_SIZE } from "@shared/constants";

// `../db` throws at import time without DATABASE_URL, and `npm test` runs with
// no env file, so the DB and the logger are pulled in lazily inside the
// I/O functions. That keeps the pure decision logic in this file directly
// unit-testable, which is the part worth testing.
async function getDb() {
  const { db } = await import("../db");
  return db;
}

async function logLine(message: string): Promise<void> {
  try {
    const { log } = await import("../log");
    log(message);
  } catch {
    console.log(message);
  }
}

export const NATIVE_WEEKLY_MARKET_TYPES = [
  "updown",
  "h2h",
  "gainer",
  "jackpot",
] as const;

export type NativeWeeklyMarketType = (typeof NATIVE_WEEKLY_MARKET_TYPES)[number];

export type WeeklyTypeCounts = Record<NativeWeeklyMarketType, number>;

/** How a type's expected count was arrived at — surfaced in the alert body. */
export type ExpectationBasis = "field-size" | "trailing-max" | "unknown";

export type TypeExpectation = {
  /** Expected market count; 0 means "no basis to judge a shortfall". */
  expected: number;
  basis: ExpectationBasis;
};

export type WeeklyShortfall = {
  marketType: NativeWeeklyMarketType;
  actual: number;
  expected: number;
  missing: number;
  basis: ExpectationBasis;
  /** A type at zero is critical; a short type is a warning. */
  severity: "critical" | "warning";
};

const TRAILING_WEEKS = 4;

function emptyCounts(): WeeklyTypeCounts {
  return { updown: 0, h2h: 0, gainer: 0, jackpot: 0 };
}

/**
 * Expected count per type. `trailingMax` supplies the self-calibrating
 * baseline for the per-category types; pass an empty object on a cold database
 * and those types fall back to "unknown", where only a zero count is
 * actionable.
 */
export function buildWeeklyExpectations(
  trailingMax: Partial<WeeklyTypeCounts>,
): Record<NativeWeeklyMarketType, TypeExpectation> {
  const fromTrailing = (t: NativeWeeklyMarketType): TypeExpectation => {
    const seen = trailingMax[t] ?? 0;
    return seen > 0
      ? { expected: seen, basis: "trailing-max" }
      : { expected: 0, basis: "unknown" };
  };

  return {
    // Both draw the same anchored field, so the field size IS the expectation.
    updown: { expected: ANCHORED_FIELD_SIZE, basis: "field-size" },
    jackpot: { expected: ANCHORED_FIELD_SIZE, basis: "field-size" },
    h2h: fromTrailing("h2h"),
    gainer: fromTrailing("gainer"),
  };
}

/**
 * Pure shortfall detection. Returns one entry per type that came up short,
 * ordered by severity then by how much is missing, so the alert leads with the
 * worst problem.
 */
export function detectWeeklyShortfalls(
  actual: WeeklyTypeCounts,
  expectations: Record<NativeWeeklyMarketType, TypeExpectation>,
): WeeklyShortfall[] {
  const shortfalls: WeeklyShortfall[] = [];

  for (const marketType of NATIVE_WEEKLY_MARKET_TYPES) {
    const got = actual[marketType] ?? 0;
    const { expected, basis } = expectations[marketType];

    // With no baseline we can still say that zero markets is broken.
    if (expected <= 0) {
      if (got === 0) {
        shortfalls.push({
          marketType,
          actual: 0,
          expected: 0,
          missing: 0,
          basis,
          severity: "critical",
        });
      }
      continue;
    }

    if (got >= expected) continue;

    shortfalls.push({
      marketType,
      actual: got,
      expected,
      missing: expected - got,
      basis,
      severity: got === 0 ? "critical" : "warning",
    });
  }

  return shortfalls.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.missing - a.missing;
  });
}

/**
 * One alert per week per distinct set of short types. A week that is short on
 * gainer stays quiet after the first send, but if H2H later goes short too the
 * changed fingerprint pings immediately. The type list is short enough to use
 * verbatim — no hashing needed to keep the key stable.
 */
export function buildShortfallIdempotencyKey(
  weekNumber: number,
  shortfalls: WeeklyShortfall[],
): string {
  const fingerprint =
    shortfalls
      .map((s) => s.marketType)
      .sort()
      .join("|") || "none";
  return `weekly_generation_shortfall:w${weekNumber}:${fingerprint}`;
}

/** Human-readable one-liner per shortfall, reused by the log and the email. */
export function describeShortfall(s: WeeklyShortfall): string {
  if (s.expected <= 0) {
    return `${s.marketType}: 0 markets created and no trailing baseline to compare against`;
  }
  const basisLabel =
    s.basis === "field-size"
      ? "anchored field size"
      : `max of trailing ${TRAILING_WEEKS} weeks`;
  return `${s.marketType}: ${s.actual} of ${s.expected} expected (${s.missing} missing, basis: ${basisLabel})`;
}

/**
 * Max per-type count over the 4 weeks before `monday`.
 *
 * Ranged on `end_at` rather than `week_number` so the ISO week wrapping from
 * 52 back to 1 at new year doesn't silently return an empty baseline.
 */
export async function loadTrailingWeeklyMax(
  monday: Date,
): Promise<Partial<WeeklyTypeCounts>> {
  const windowStart = new Date(
    monday.getTime() - TRAILING_WEEKS * 7 * 24 * 60 * 60 * 1000,
  );

  const db = await getDb();
  const rows = await db
    .select({
      marketType: predictionMarkets.marketType,
      weekNumber: predictionMarkets.weekNumber,
      count: sql<number>`count(*)`,
    })
    .from(predictionMarkets)
    .where(
      and(
        inArray(predictionMarkets.marketType, [...NATIVE_WEEKLY_MARKET_TYPES]),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
        gte(predictionMarkets.endAt, windowStart),
        lt(predictionMarkets.endAt, monday),
      ),
    )
    .groupBy(predictionMarkets.marketType, predictionMarkets.weekNumber);

  const max: Partial<WeeklyTypeCounts> = {};
  for (const row of rows) {
    const key = row.marketType as NativeWeeklyMarketType;
    if (!NATIVE_WEEKLY_MARKET_TYPES.includes(key)) continue;
    const n = Number(row.count) || 0;
    if (n > (max[key] ?? 0)) max[key] = n;
  }
  return max;
}

/** Per-type OPEN counts for the week being checked. */
export async function loadWeeklyTypeCounts(
  weekNumber: number,
  monday: Date,
): Promise<WeeklyTypeCounts> {
  const db = await getDb();
  const rows = await db
    .select({
      marketType: predictionMarkets.marketType,
      count: sql<number>`count(*)`,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.status, "OPEN"),
        inArray(predictionMarkets.marketType, [...NATIVE_WEEKLY_MARKET_TYPES]),
        inArray(predictionMarkets.visibility, ["live", "inactive"]),
        eq(predictionMarkets.weekNumber, weekNumber),
        gte(predictionMarkets.endAt, monday),
      ),
    )
    .groupBy(predictionMarkets.marketType);

  const counts = emptyCounts();
  for (const row of rows) {
    const key = row.marketType as NativeWeeklyMarketType;
    if (key in counts) counts[key] = Number(row.count) || 0;
  }
  return counts;
}

export type WeeklyGenerationHealth = {
  weekNumber: number;
  counts: WeeklyTypeCounts;
  expectations: Record<NativeWeeklyMarketType, TypeExpectation>;
  shortfalls: WeeklyShortfall[];
  alerted: boolean;
};

/**
 * Check the week that was just generated and alert on any shortfall.
 *
 * Best-effort throughout: a failure in here is logged and swallowed so the
 * monitor can never take down the generation path it monitors.
 */
export async function checkWeeklyGenerationHealth(
  weekNumber: number,
  monday: Date,
  /**
   * Per-type counts the caller has already taken for this week. Supplied by
   * `ensureWeeklyMarketsForCurrentWeek`, which counts inside its advisory lock
   * anyway — passing them avoids a redundant query and, more importantly,
   * means the alert judges the same numbers the caller logged.
   */
  knownCounts?: WeeklyTypeCounts,
): Promise<WeeklyGenerationHealth | null> {
  try {
    const [counts, trailingMax] = await Promise.all([
      knownCounts ?? loadWeeklyTypeCounts(weekNumber, monday),
      loadTrailingWeeklyMax(monday),
    ]);

    const expectations = buildWeeklyExpectations(trailingMax);
    const shortfalls = detectWeeklyShortfalls(counts, expectations);

    if (shortfalls.length === 0) {
      await logLine(
        `[MarketGenerator:Health] Week ${weekNumber} complete — ` +
          `updown=${counts.updown} h2h=${counts.h2h} gainer=${counts.gainer} jackpot=${counts.jackpot}`,
      );
      return { weekNumber, counts, expectations, shortfalls, alerted: false };
    }

    const criticals = shortfalls.filter((s) => s.severity === "critical");
    for (const s of shortfalls) {
      await logLine(
        `[MarketGenerator:Health][ALERT] Week ${weekNumber} ${describeShortfall(s)}`,
      );
    }

    const alerted = await sendShortfallAlert(weekNumber, counts, shortfalls, criticals.length > 0);
    return { weekNumber, counts, expectations, shortfalls, alerted };
  } catch (err) {
    await logLine(
      `[MarketGenerator:Health] Check failed (continuing): ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

async function sendShortfallAlert(
  weekNumber: number,
  counts: WeeklyTypeCounts,
  shortfalls: WeeklyShortfall[],
  hasCritical: boolean,
): Promise<boolean> {
  try {
    const { sendOpsAlert, adminDashboardUrl } = await import(
      "../services/ops-alerts"
    );

    const totalMissing = shortfalls.reduce((sum, s) => sum + s.missing, 0);
    const typeList = shortfalls.map((s) => s.marketType).join(", ");

    await sendOpsAlert({
      kind: "weekly_generation_shortfall",
      severity: hasCritical ? "critical" : "warning",
      title: `Weekly native markets short — week ${weekNumber} (${typeList})`,
      summary:
        `${shortfalls.length} market type(s) came up short` +
        (totalMissing > 0 ? `, ${totalMissing} market(s) missing. ` : ". ") +
        `A short type is NOT backfilled automatically — the Monday freeze skips ` +
        `any type that already has open markets, so this needs a manual top-up.`,
      sections: [
        {
          heading: "Shortfalls",
          items: shortfalls.map((s) => ({
            text: `${s.marketType} (${s.severity})`,
            detail: describeShortfall(s),
          })),
        },
        {
          heading: "Week totals",
          items: NATIVE_WEEKLY_MARKET_TYPES.map((t) => ({
            text: t,
            detail: `${counts[t]} open`,
          })),
        },
        {
          heading: "Likely causes",
          items: [
            {
              text: "House credits exhausted mid-batch",
              detail:
                "seedAmmMarket throws when the house cannot cover a seed, which rolls back that market's transaction. Check the house balance first.",
            },
            {
              text: "A generator threw partway through",
              detail:
                "Search logs for [MarketGenerator] around the generation run for the failing type.",
            },
          ],
        },
      ],
      ctaUrl: `${adminDashboardUrl()}?section=amm&tab=operations`,
      ctaLabel: "Open AMM Operations",
      idempotencyKeyBase: buildShortfallIdempotencyKey(weekNumber, shortfalls),
    });
    return true;
  } catch (err) {
    await logLine(
      `[MarketGenerator:Health] Ops alert failed (continuing): ${err instanceof Error ? err.message : err}`,
    );
    return false;
  }
}
