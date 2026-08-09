/**
 * Re-sync drafts whose Polymarket source rescheduled after import.
 *
 * The automatic resync can't rescue these. Its ownership check only adopts a
 * sync baseline when our endAt still matches the source, so a draft that
 * drifted before `syncedEndDate` existed is permanently ineligible: it looks
 * like an admin edit, which resync deliberately leaves alone.
 *
 * This adopts the source's current schedule explicitly and writes the
 * baseline, so ordinary resync takes over from here. That is the opposite of
 * ops/repair-ladder-market-end-dates.ts, which pushes endAt AWAY from the
 * source endDate and leaves syncedEndDate untouched so the row reads as
 * admin-owned — there the source date was wrong, here we are simply behind it.
 *
 * Only touches drafts whose sole health complaint is the drift. A market with
 * a broken book needs retiring, not rescheduling.
 *
 * Run:
 *   npx tsx --env-file=.env ops/repair-drifted-draft-schedules.ts --dry-run
 *   npx tsx --env-file=.env ops/repair-drifted-draft-schedules.ts --apply
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
const COOLDOWN_MS = 5 * 60 * 1000;

async function main(): Promise<void> {
  console.log(`\n[repair-drifted-draft-schedules] ${DRY_RUN ? "DRY RUN" : "APPLY"}`);

  const { db, pool } = await import("../server/db");
  const { predictionMarkets, adminAuditLog } = await import("../shared/schema");
  const { and, eq, sql } = await import("drizzle-orm");
  const { fetchPolymarketEventResolutions } = await import(
    "../server/providers/polymarket"
  );
  const {
    deriveResolutionBackstop,
    deriveTradingCloseAt,
    DEFAULT_RESOLUTION_BACKSTOP_DAYS,
    DEFAULT_TRADING_EXTENSION_DAYS,
  } = await import("../server/jobs/market-time-sync-utils");

  const drafts = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      endAt: predictionMarkets.endAt,
      closeAt: predictionMarkets.closeAt,
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        eq(predictionMarkets.visibility, "draft"),
        eq(predictionMarkets.status, "OPEN"),
      ),
    );

  let repaired = 0;
  let skipped = 0;

  for (const d of drafts) {
    const meta =
      d.metadata && typeof d.metadata === "object"
        ? (d.metadata as Record<string, unknown>)
        : {};
    const health = meta.draftHealth as { flags?: string[] } | undefined;
    const flags = Array.isArray(health?.flags) ? health!.flags! : [];
    if (!flags.includes("schedule_drift")) continue;
    if (flags.some((f) => f !== "schedule_drift")) {
      console.log(`\n  SKIP (other flags: ${flags.join(", ")}) ${d.title}`);
      skipped += 1;
      continue;
    }

    const src =
      meta.source && typeof meta.source === "object"
        ? (meta.source as Record<string, unknown>)
        : {};
    const externalId = typeof src.externalId === "string" ? src.externalId : null;
    if (!externalId) {
      skipped += 1;
      continue;
    }

    const snapshot = await fetchPolymarketEventResolutions(externalId);
    const sourceEndDate = snapshot?.endDate ?? null;
    if (!sourceEndDate) {
      console.log(`\n  SKIP (no source endDate) ${d.title}`);
      skipped += 1;
      continue;
    }

    const nominalEndAt = new Date(sourceEndDate);
    if (isNaN(nominalEndAt.getTime()) || nominalEndAt.getTime() <= Date.now()) {
      console.log(`\n  SKIP (source endDate is past) ${d.title}`);
      skipped += 1;
      continue;
    }

    const rulesText =
      typeof src.resolutionRulesText === "string" ? src.resolutionRulesText : null;
    const contextText = [
      d.title,
      Array.isArray(d.resolutionCriteria)
        ? (d.resolutionCriteria as string[]).join("; ")
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
      skipped += 1;
      continue;
    }

    const nextEndAt = backstop.isDataLags ? backstop.backstopAt : nominalEndAt;
    const nextCloseAt = deriveTradingCloseAt({
      endDate: nominalEndAt,
      backstopAt: backstop.backstopAt,
      isDataLags: backstop.isDataLags,
      cooldownMs: COOLDOWN_MS,
      extensionDays: DEFAULT_TRADING_EXTENSION_DAYS,
      gameStartTime: snapshot?.gameStartTime ?? null,
    });
    if (!nextCloseAt) {
      skipped += 1;
      continue;
    }

    const prevEnd = d.endAt ? new Date(d.endAt) : null;

    // The draftHealth flag is only refreshed by the daily watcher, so a
    // second run would re-select rows this script already fixed. Compare the
    // derived values instead of trusting the cached flag.
    const sameEnd =
      prevEnd && Math.abs(prevEnd.getTime() - nextEndAt.getTime()) <= 60_000;
    const sameClose =
      d.closeAt &&
      Math.abs(new Date(d.closeAt).getTime() - nextCloseAt.getTime()) <= 60_000;
    const sameBaseline =
      typeof src.syncedEndDate === "string" &&
      Math.abs(Date.parse(src.syncedEndDate) - nominalEndAt.getTime()) <= 60_000;
    if (sameEnd && sameClose && sameBaseline) {
      skipped += 1;
      continue;
    }

    console.log(`\n  ${d.title}`);
    console.log(
      `    endAt   ${prevEnd?.toISOString() ?? "null"} → ${nextEndAt.toISOString()}`,
    );
    console.log(
      `    closeAt ${d.closeAt ? new Date(d.closeAt).toISOString() : "null"} → ${nextCloseAt.toISOString()}`,
    );
    console.log(`    syncedEndDate baseline → ${nominalEndAt.toISOString()}`);
    repaired += 1;

    if (DRY_RUN) continue;

    const payload: Record<string, unknown> = {
      nominalSourceEndAt: nominalEndAt.toISOString(),
      resolutionBackstopAt: backstop.backstopAt.toISOString(),
      source: {
        ...src,
        // Adopting the baseline is the point: without it the ownership check
        // keeps reading this row as admin-edited and resync stays disabled.
        syncedEndDate: nominalEndAt.toISOString(),
        syncedGameStartTime: snapshot?.gameStartTime ?? null,
        lastTimeSyncAt: new Date().toISOString(),
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
      .where(eq(predictionMarkets.id, d.id));

    await db.insert(adminAuditLog).values({
      adminId: ADMIN_ID,
      adminEmail: null,
      actionType: "repair_drifted_draft_schedule",
      targetTable: "prediction_markets",
      targetId: d.id,
      previousData: {
        endAt: prevEnd?.toISOString() ?? null,
        closeAt: d.closeAt ? new Date(d.closeAt).toISOString() : null,
      },
      newData: {
        endAt: nextEndAt.toISOString(),
        closeAt: nextCloseAt.toISOString(),
        syncedEndDate: nominalEndAt.toISOString(),
      },
      metadata: {
        reason: "source_rescheduled_before_sync_baseline_existed",
        script: "ops/repair-drifted-draft-schedules.ts",
      },
    });
  }

  console.log(
    `\n[repair-drifted-draft-schedules] ${DRY_RUN ? "would repair" : "repaired"}=${repaired} skipped=${skipped}\n`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error("[repair-drifted-draft-schedules] failed:", err);
  process.exit(1);
});
