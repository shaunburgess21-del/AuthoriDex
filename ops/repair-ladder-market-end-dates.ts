/**
 * Repair cumulative-ladder World Markets whose endAt was imported from the
 * Polymarket *event* endDate instead of the latest rung's sub-market endDate.
 *
 * Background (2026-08-08):
 *   Ladder events ("When will X happen?" with by-date rungs) carry an
 *   event-level endDate that tracks the *near* rungs, while a long-tail rung
 *   runs months later. The scout imported that event endDate verbatim, so the
 *   market queues for manual resolution long before its final rung can be
 *   judged — e.g. the Alito market ends 2026-12-31 while its last rung is
 *   "June 30, 2027". Trading also closes on the wrong date, freezing an
 *   actively traded market for months.
 *
 *   New ladder imports are gated at the provider (isUnsettleableLadder), so
 *   this only repairs rows created before that gate.
 *
 * This script (idempotent, per market):
 *   1. Reads metadata.source.outcomeMapping and fetches the Gamma event.
 *   2. Takes the latest endDate across the *mapped* sub-markets as the true
 *      nominal end.
 *   3. Re-derives endAt / closeAt / resolutionBackstopAt with the same helpers
 *      the scout import uses (deriveResolutionBackstop, deriveTradingCloseAt).
 *   4. Leaves metadata.source.syncedEndDate untouched, so shouldApplyResync
 *      sees nominalSourceEndAt ≠ syncedEndDate and treats the schedule as
 *      admin-owned — otherwise the next source-watch tick would drag endAt
 *      back to the event endDate.
 *   5. Logs to admin_audit_log.
 *
 * Run:
 *   npx tsx --env-file=.env ops/repair-ladder-market-end-dates.ts --dry-run
 *   npx tsx --env-file=.env ops/repair-ladder-market-end-dates.ts --apply
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DRY_RUN = !APPLY;

const ADMIN_ID = "035adc7b-6087-421e-b635-b6b9ad2c8cd2"; // Randy_Andy

interface RepairTarget {
  marketId: string;
  titleContains: string;
  /** Sanity bound — refuse to move endAt past this. */
  maxEndAt: string;
}

const TARGETS: RepairTarget[] = [
  {
    marketId: "fc20d4b5-5b83-42f1-8a40-ac947b37adfb",
    titleContains: "Samuel Alito",
    maxEndAt: "2027-12-31T00:00:00Z",
  },
];

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";

interface GammaSubMarket {
  id?: string;
  groupItemTitle?: string;
  endDate?: string;
}

async function fetchEventSubMarkets(externalId: string): Promise<GammaSubMarket[]> {
  const res = await fetch(`${GAMMA_EVENTS_URL}?id=${encodeURIComponent(externalId)}`);
  if (!res.ok) throw new Error(`Gamma ${res.status} for event ${externalId}`);
  const body = (await res.json()) as Array<{ markets?: GammaSubMarket[] }>;
  const ev = Array.isArray(body) ? body[0] : null;
  return Array.isArray(ev?.markets) ? ev!.markets! : [];
}

async function main(): Promise<void> {
  console.log(`\n[repair-ladder-market-end-dates] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, adminAuditLog } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const {
    deriveResolutionBackstop,
    deriveTradingCloseAt,
    DEFAULT_RESOLUTION_BACKSTOP_DAYS,
    DEFAULT_TRADING_EXTENSION_DAYS,
  } = await import("../server/jobs/market-time-sync-utils");

  let repaired = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    console.log(`\n── ${target.titleContains} (${target.marketId.slice(0, 8)}) ──`);

    const [market] = await db
      .select({
        id: predictionMarkets.id,
        title: predictionMarkets.title,
        status: predictionMarkets.status,
        closeAt: predictionMarkets.closeAt,
        endAt: predictionMarkets.endAt,
        resolutionCriteria: predictionMarkets.resolutionCriteria,
        metadata: predictionMarkets.metadata,
      })
      .from(predictionMarkets)
      .where(eq(predictionMarkets.id, target.marketId))
      .limit(1);

    if (!market) {
      console.log(`  ! market not found — skipping`);
      skipped += 1;
      continue;
    }
    if (!market.title?.includes(target.titleContains)) {
      console.log(`  ! title mismatch ("${market.title}") — skipping`);
      skipped += 1;
      continue;
    }
    if (market.status !== "OPEN") {
      console.log(`  ! status is ${market.status}, expected OPEN — skipping`);
      skipped += 1;
      continue;
    }

    const meta =
      market.metadata && typeof market.metadata === "object"
        ? (market.metadata as Record<string, unknown>)
        : {};
    if (meta.autoLockedAt) {
      console.log(`  ! already auto-locked (${String(meta.autoLockedAt)}) — skipping`);
      skipped += 1;
      continue;
    }

    const source =
      meta.source && typeof meta.source === "object"
        ? (meta.source as Record<string, unknown>)
        : {};
    const externalId = typeof source.externalId === "string" ? source.externalId : null;
    if (!externalId) {
      console.log(`  ! no source.externalId — skipping`);
      skipped += 1;
      continue;
    }

    const mapping = Array.isArray(source.outcomeMapping)
      ? (source.outcomeMapping as Array<Record<string, unknown>>)
      : [];
    const mappedIds = new Set(
      mapping
        .map((m) => (typeof m.sourceMarketId === "string" ? m.sourceMarketId : null))
        .filter((v): v is string => !!v),
    );
    if (mappedIds.size === 0) {
      console.log(`  ! no mapped sourceMarketIds — skipping`);
      skipped += 1;
      continue;
    }

    const subMarkets = await fetchEventSubMarkets(externalId);
    const mappedRungs = subMarkets
      .filter((m) => m.id && mappedIds.has(String(m.id)))
      .map((m) => ({
        label: m.groupItemTitle ?? "(unnamed)",
        endAt: m.endDate ? new Date(m.endDate) : null,
      }))
      .filter((r) => r.endAt && !isNaN(r.endAt.getTime()));

    if (mappedRungs.length === 0) {
      console.log(`  ! no mapped sub-markets resolved against Gamma — skipping`);
      skipped += 1;
      continue;
    }

    for (const r of mappedRungs) {
      console.log(`    rung ${r.label.padEnd(18)} ends ${r.endAt!.toISOString()}`);
    }

    const latest = mappedRungs.reduce((a, b) =>
      b.endAt!.getTime() > a.endAt!.getTime() ? b : a,
    );
    const nominalEndAt = latest.endAt!;
    const currentEndAt = market.endAt ? new Date(market.endAt) : null;

    if (nominalEndAt.getTime() > new Date(target.maxEndAt).getTime()) {
      console.log(
        `  ! derived nominal end ${nominalEndAt.toISOString()} exceeds maxEndAt ` +
          `${target.maxEndAt} — refusing`,
      );
      skipped += 1;
      continue;
    }
    if (currentEndAt && nominalEndAt.getTime() <= currentEndAt.getTime() + 60_000) {
      console.log(
        `  = endAt ${currentEndAt.toISOString()} already covers the last rung ` +
          `(${nominalEndAt.toISOString()}) — nothing to do`,
      );
      skipped += 1;
      continue;
    }

    const rulesText =
      typeof source.resolutionRulesText === "string" ? source.resolutionRulesText : null;
    const contextText = [
      market.title,
      Array.isArray(market.resolutionCriteria)
        ? (market.resolutionCriteria as string[]).join("; ")
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const backstop = deriveResolutionBackstop({
      endDate: nominalEndAt,
      rulesText,
      contextText,
      bufferDays: DEFAULT_RESOLUTION_BACKSTOP_DAYS,
    });
    if (!backstop) {
      console.log(`  ! backstop derivation failed — skipping`);
      skipped += 1;
      continue;
    }

    const cooldownMs = 5 * 60 * 1000;
    const nextEndAt = backstop.isDataLags ? backstop.backstopAt : nominalEndAt;
    const nextCloseAt = deriveTradingCloseAt({
      endDate: nominalEndAt,
      backstopAt: backstop.backstopAt,
      isDataLags: backstop.isDataLags,
      cooldownMs,
      extensionDays: DEFAULT_TRADING_EXTENSION_DAYS,
    });
    if (!nextCloseAt) {
      console.log(`  ! closeAt derivation failed — skipping`);
      skipped += 1;
      continue;
    }

    console.log(`  last rung   : ${latest.label} (${nominalEndAt.toISOString()})`);
    console.log(
      `  endAt       : ${currentEndAt?.toISOString() ?? "null"} → ${nextEndAt.toISOString()}`,
    );
    console.log(
      `  closeAt     : ${market.closeAt ? new Date(market.closeAt).toISOString() : "null"} → ${nextCloseAt.toISOString()}`,
    );
    console.log(
      `  backstopAt  : ${String(meta.resolutionBackstopAt ?? "null")} → ${backstop.backstopAt.toISOString()}`,
    );
    console.log(
      `  syncedEndDate stays ${String(source.syncedEndDate ?? "null")} (marks schedule admin-owned)`,
    );

    if (DRY_RUN) {
      repaired += 1;
      continue;
    }

    const payload: Record<string, unknown> = {
      nominalSourceEndAt: nominalEndAt.toISOString(),
      resolutionBackstopAt: backstop.backstopAt.toISOString(),
      ladderEndDateRepair: {
        repairedAt: new Date().toISOString(),
        previousEndAt: currentEndAt?.toISOString() ?? null,
        previousCloseAt: market.closeAt ? new Date(market.closeAt).toISOString() : null,
        lastRungLabel: latest.label,
        script: "ops/repair-ladder-market-end-dates.ts",
      },
      ...(backstop.isDataLags ? { dataLagsMarket: true } : {}),
    };

    await db
      .update(predictionMarkets)
      .set({
        endAt: nextEndAt,
        closeAt: nextCloseAt,
        metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(predictionMarkets.id, target.marketId));

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "repair_ladder_market_end_date",
      targetTable: "prediction_markets",
      targetId: target.marketId,
      previousData: {
        endAt: currentEndAt?.toISOString() ?? null,
        closeAt: market.closeAt ? new Date(market.closeAt).toISOString() : null,
        resolutionBackstopAt: meta.resolutionBackstopAt ?? null,
        nominalSourceEndAt: meta.nominalSourceEndAt ?? null,
      },
      newData: {
        endAt: nextEndAt.toISOString(),
        closeAt: nextCloseAt.toISOString(),
        resolutionBackstopAt: backstop.backstopAt.toISOString(),
        nominalSourceEndAt: nominalEndAt.toISOString(),
      },
      metadata: {
        reason: "cumulative_ladder_event_end_date_shorter_than_last_rung",
        lastRungLabel: latest.label,
        script: "ops/repair-ladder-market-end-dates.ts",
      },
    });

    console.log(`  ✔ repaired`);
    repaired += 1;
  }

  console.log(
    `\n[repair-ladder-market-end-dates] ${DRY_RUN ? "would repair" : "repaired"}=${repaired} skipped=${skipped}`,
  );
  // Drain the pool instead of process.exit — an abrupt exit trips a libuv
  // assertion on Windows while the pg socket is still closing.
  await pool.end();
}

main().catch((err) => {
  console.error(`[repair-ladder-market-end-dates] failed:`, err);
  process.exit(1);
});
