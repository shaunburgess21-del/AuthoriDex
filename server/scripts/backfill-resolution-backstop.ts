/**
 * Backfill resolutionBackstopAt (+ optional reopen) for scouted World Markets.
 *
 * For each community market with a Polymarket source:
 *   1. Derive resolutionBackstopAt from rules prose / buffer.
 *   2. Stamp metadata.resolutionBackstopAt (+ dataLagsMarket / nominalSourceEndAt).
 *   3. Optionally recompute closeAt for data-lags markets still OPEN.
 *   4. Optionally reopen CLOSED_PENDING rows whose source is unresolved and
 *      whose backstop is still in the future (premature queue fix).
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/backfill-resolution-backstop.ts
 *   npx tsx --env-file=.env server/scripts/backfill-resolution-backstop.ts --apply
 *   npx tsx --env-file=.env server/scripts/backfill-resolution-backstop.ts --apply --reopen
 *   npx tsx --env-file=.env server/scripts/backfill-resolution-backstop.ts --apply --reopen --extend-close
 *
 * Default is DRY-RUN (no DB writes).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { predictionMarkets } from "@shared/schema";
import { getAmmCooldownMs } from "../native-markets/amm-settings";
import {
  deriveResolutionBackstop,
  deriveTradingCloseAt,
  DEFAULT_RESOLUTION_BACKSTOP_DAYS,
  DEFAULT_TRADING_EXTENSION_DAYS,
  readResolutionBackstopAt,
} from "../jobs/market-time-sync-utils";

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");
const reopenMode = args.includes("--reopen");
const extendCloseMode = args.includes("--extend-close");

function bufferDays(): number {
  const raw = Number(process.env.WORLD_MARKET_RESOLUTION_BACKSTOP_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESOLUTION_BACKSTOP_DAYS;
}

function extensionDays(): number {
  const raw = Number(process.env.WORLD_MARKET_TRADING_EXTENSION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TRADING_EXTENSION_DAYS;
}

async function main() {
  console.log(
    `[BackfillBackstop] mode=${applyMode ? "APPLY" : "DRY-RUN"} ` +
      `reopen=${reopenMode} extendClose=${extendCloseMode}`,
  );

  const rows = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      status: predictionMarkets.status,
      endAt: predictionMarkets.endAt,
      closeAt: predictionMarkets.closeAt,
      metadata: predictionMarkets.metadata,
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      teaser: predictionMarkets.teaser,
      summary: predictionMarkets.summary,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
      ),
    );

  const cooldownMs = getAmmCooldownMs();
  let stamped = 0;
  let skipped = 0;
  let reopened = 0;
  let closeExtended = 0;

  for (const row of rows) {
    const meta =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const source =
      meta.source && typeof meta.source === "object"
        ? (meta.source as Record<string, unknown>)
        : null;
    if (!source || source.provider !== "polymarket") {
      skipped += 1;
      continue;
    }

    const rulesText =
      typeof source.resolutionRulesText === "string"
        ? source.resolutionRulesText
        : null;
    const nominalRaw =
      typeof meta.nominalSourceEndAt === "string"
        ? meta.nominalSourceEndAt
        : typeof source.syncedEndDate === "string"
          ? source.syncedEndDate
          : row.endAt;
    const nominalEnd = new Date(nominalRaw as string | Date);
    if (isNaN(nominalEnd.getTime())) {
      skipped += 1;
      continue;
    }

    const contextText = [
      row.title,
      row.teaser,
      row.summary,
      Array.isArray(row.resolutionCriteria)
        ? row.resolutionCriteria.join("; ")
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    const derived = deriveResolutionBackstop({
      endDate: nominalEnd,
      rulesText,
      contextText,
      bufferDays: bufferDays(),
    });
    if (!derived) {
      skipped += 1;
      continue;
    }

    const existingBackstop = readResolutionBackstopAt(meta);
    const needsStamp =
      !existingBackstop ||
      Math.abs(existingBackstop.getTime() - derived.backstopAt.getTime()) > 60_000;

    const upstreamResolved =
      typeof source.upstreamResolvedAt === "string" &&
      !!source.upstreamResolvedAt.trim();
    const shouldReopen =
      reopenMode &&
      row.status === "CLOSED_PENDING" &&
      !upstreamResolved &&
      derived.backstopAt.getTime() > Date.now();

    let nextCloseAt: Date | null = null;
    if (
      extendCloseMode &&
      derived.isDataLags &&
      (row.status === "OPEN" || shouldReopen)
    ) {
      nextCloseAt = deriveTradingCloseAt({
        endDate: nominalEnd,
        backstopAt: derived.backstopAt,
        isDataLags: true,
        cooldownMs,
        extensionDays: extensionDays(),
        gameStartTime:
          typeof source.gameStartTime === "string" ? source.gameStartTime : null,
      });
    }

    console.log(
      `  ${row.id.slice(0, 8)} "${row.title.slice(0, 50)}" ` +
        `status=${row.status} ` +
        `backstop=${derived.backstopAt.toISOString().slice(0, 10)} ` +
        `dataLags=${derived.isDataLags} ` +
        `stamp=${needsStamp} reopen=${shouldReopen} ` +
        `close=${nextCloseAt?.toISOString() ?? "-"}`,
    );

    if (!applyMode) {
      if (needsStamp) stamped += 1;
      if (shouldReopen) reopened += 1;
      if (nextCloseAt) closeExtended += 1;
      continue;
    }

    const payload: Record<string, unknown> = {
      resolutionBackstopAt: derived.backstopAt.toISOString(),
      nominalSourceEndAt: nominalEnd.toISOString(),
    };
    if (derived.isDataLags) payload.dataLagsMarket = true;

    const updates: Record<string, unknown> = {
      metadata: sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
      updatedAt: new Date(),
    };

    if (shouldReopen) {
      updates.status = "OPEN";
      updates.resolutionNotes = null;
      updates.resolvedAt = null;
      // Push endAt out to the backstop so the resolver doesn't re-queue.
      updates.endAt = derived.backstopAt;
      reopened += 1;
    } else if (
      derived.isDataLags &&
      row.status === "OPEN" &&
      row.endAt &&
      new Date(row.endAt).getTime() < derived.backstopAt.getTime() - 60_000
    ) {
      // Align OPEN data-lags markets so endAt = backstop (resolver gate).
      updates.endAt = derived.backstopAt;
    }

    if (nextCloseAt) {
      updates.closeAt = nextCloseAt;
      closeExtended += 1;
    }

    await db
      .update(predictionMarkets)
      .set(updates)
      .where(eq(predictionMarkets.id, row.id));
    if (needsStamp) stamped += 1;
  }

  console.log(
    `[BackfillBackstop] done stamped=${stamped} reopened=${reopened} ` +
      `closeExtended=${closeExtended} skipped=${skipped} total=${rows.length}`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[BackfillBackstop] fatal:", err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
