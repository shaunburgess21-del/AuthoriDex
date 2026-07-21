/**
 * Shared loader for scouted World Market source-anchor desync checks.
 * Used by /api/admin/ops-summary and /api/admin/amm/health.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { marketEntries, predictionMarkets } from "@shared/schema";
import {
  detectSourceAnchorDesync,
  type SourceAnchorDesyncRow,
} from "../agents/sourceSync";

export async function loadSourceAnchorDesync(): Promise<SourceAnchorDesyncRow[]> {
  const scoutedOpen = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        inArray(predictionMarkets.status, ["OPEN", "CLOSED_PENDING"]),
        sql`${predictionMarkets.metadata}->>'scoutedByMarketScout' = 'true'`,
      ),
    );

  if (scoutedOpen.length === 0) return [];

  const scoutedIds = scoutedOpen.map((m) => m.id);
  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      label: marketEntries.label,
      displayOrder: marketEntries.displayOrder,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, scoutedIds))
    .orderBy(asc(marketEntries.displayOrder));

  const entriesByMarket = new Map<string, Array<{ id: string; label: string | null }>>();
  for (const e of entryRows) {
    const list = entriesByMarket.get(e.marketId) ?? [];
    list.push({ id: e.id, label: e.label });
    entriesByMarket.set(e.marketId, list);
  }

  return detectSourceAnchorDesync(
    scoutedOpen.map((m) => {
      const entries = entriesByMarket.get(m.id) ?? [];
      return {
        marketId: m.id,
        title: m.title,
        entryCount: entries.length,
        metadata: m.metadata,
        entries,
      };
    }),
  );
}
