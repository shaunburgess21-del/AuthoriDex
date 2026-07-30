import { asc, inArray } from "drizzle-orm";
import { db } from "../db";
import { marketAmmState, marketEntries, predictionMarkets } from "@shared/schema";
import { currentPrices } from "@shared/lib/amm/positions";

const TOP_MULTI_COUNT = 3;

export type VoicesWorldMarketPreview =
  | {
      layout: "binary";
      left: { label: string; percent: number };
      right: { label: string; percent: number };
      isClassicYesNo: boolean;
    }
  | {
      layout: "multi";
      totalOutcomes: number;
      topOutcomes: Array<{ label: string; percent: number }>;
    };

interface EntryRow {
  marketId: string;
  id: string;
  label: string;
  displayOrder: number;
}

function normalizeEntryLabel(label: unknown) {
  return String(label || "").trim();
}

function isClassicYesNoLabels(leftLabel: string, rightLabel: string) {
  return leftLabel.toLowerCase() === "yes" && rightLabel.toLowerCase() === "no";
}

/** Resolve binary sides by Yes/No label when present; otherwise display order. */
function resolveBinaryEntries(entries: EntryRow[]) {
  const byLabel = (wanted: string) =>
    entries.find((e) => normalizeEntryLabel(e.label).toLowerCase() === wanted);
  const leftEntry = byLabel("yes") || entries[0];
  const rightEntry =
    byLabel("no") ||
    entries.find((e) => e && e !== leftEntry) ||
    entries[1];
  return { leftEntry, rightEntry };
}

function pricePercent(price: number) {
  return Math.max(0, Math.min(100, Math.round(price * 100)));
}

/**
 * Batch-load live LMSR outcome percentages for World Market Voices link cards.
 * Mirrors AMM pricing in GET /api/open-markets.
 */
export async function loadWorldMarketPreview(
  marketIds: string[],
): Promise<Map<string, VoicesWorldMarketPreview>> {
  const out = new Map<string, VoicesWorldMarketPreview>();
  if (marketIds.length === 0) return out;

  const marketRows = await db
    .select({
      id: predictionMarkets.id,
      engine: predictionMarkets.engine,
      openMarketType: predictionMarkets.openMarketType,
    })
    .from(predictionMarkets)
    .where(inArray(predictionMarkets.id, marketIds));

  const ammMarketIds = marketRows.filter((m) => m.engine === "amm").map((m) => m.id);
  if (ammMarketIds.length === 0) return out;

  const entryRows = await db
    .select({
      marketId: marketEntries.marketId,
      id: marketEntries.id,
      label: marketEntries.label,
      displayOrder: marketEntries.displayOrder,
    })
    .from(marketEntries)
    .where(inArray(marketEntries.marketId, ammMarketIds))
    .orderBy(asc(marketEntries.marketId), asc(marketEntries.displayOrder));

  const entriesByMarket = new Map<string, EntryRow[]>();
  for (const row of entryRows) {
    const list = entriesByMarket.get(row.marketId) ?? [];
    list.push(row);
    entriesByMarket.set(row.marketId, list);
  }

  const ammRows = await db
    .select({
      marketId: marketAmmState.marketId,
      liquidityB: marketAmmState.liquidityB,
      outcomeOrder: marketAmmState.outcomeOrder,
      shareQuantities: marketAmmState.shareQuantities,
    })
    .from(marketAmmState)
    .where(inArray(marketAmmState.marketId, ammMarketIds));

  const ammByMarket = new Map(
    ammRows.map((r) => [
      r.marketId,
      {
        liquidityB: Number(r.liquidityB),
        outcomeOrder: r.outcomeOrder as string[],
        shareQuantities: r.shareQuantities as Record<string, number>,
      },
    ]),
  );

  const marketMeta = new Map(marketRows.map((m) => [m.id, m]));

  for (const marketId of ammMarketIds) {
    const entries = entriesByMarket.get(marketId) ?? [];
    const ammState = ammByMarket.get(marketId);
    if (entries.length === 0 || !ammState) continue;

    const prices = currentPrices(ammState);
    const meta = marketMeta.get(marketId);
    const isMulti =
      meta?.openMarketType === "multi" || entries.length > 2;

    if (isMulti) {
      const ranked = entries
        .map((e) => ({
          label: normalizeEntryLabel(e.label) || "Outcome",
          percent: pricePercent(Number(prices[e.id] ?? 0)),
        }))
        .sort((a, b) => b.percent - a.percent);

      out.set(marketId, {
        layout: "multi",
        totalOutcomes: entries.length,
        topOutcomes: ranked.slice(0, TOP_MULTI_COUNT),
      });
      continue;
    }

    const { leftEntry, rightEntry } = resolveBinaryEntries(entries);
    if (!leftEntry || !rightEntry) continue;

    const leftLabel = normalizeEntryLabel(leftEntry.label) || "Yes";
    const rightLabel = normalizeEntryLabel(rightEntry.label) || "No";
    const leftPercent = pricePercent(Number(prices[leftEntry.id] ?? 0));
    const rightPercent = Math.max(0, 100 - leftPercent);

    out.set(marketId, {
      layout: "binary",
      left: { label: leftLabel, percent: leftPercent },
      right: { label: rightLabel, percent: rightPercent },
      isClassicYesNo: isClassicYesNoLabels(leftLabel, rightLabel),
    });
  }

  return out;
}
