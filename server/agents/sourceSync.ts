/**
 * Keep metadata.source outcome vectors aligned with market_entries.
 *
 * The admin edit modal can add/remove an "Other" catch-all without the
 * scout re-importing. When that happens, outcomeMapping / pricesAtImport /
 * livePrices must gain or lose a residual slot — otherwise
 * `readSourceFairByEntryId` rejects the whole anchor (length mismatch)
 * and agents go dark under assessments-off mode.
 */

import {
  OTHER_OUTCOME_LABEL,
  isOtherStyleOutcomeLabel,
} from "@shared/lib/other-outcome";
import { readSourceFairByEntryId } from "./sourceFair";

export interface SourceOutcomeMappingRow {
  entryLabel?: string;
  sourceLabel?: string;
  sourceMarketId?: string;
  sourceOutcomeIndex?: number;
  isResidual?: boolean;
}

function isResidualMappingRow(row: SourceOutcomeMappingRow): boolean {
  if (row.isResidual === true) return true;
  return (
    isOtherStyleOutcomeLabel(row.entryLabel) ||
    isOtherStyleOutcomeLabel(row.sourceLabel)
  );
}

function mappingHasOtherLabel(mapping: SourceOutcomeMappingRow[]): boolean {
  return mapping.some((row) => isResidualMappingRow(row));
}

function entriesHaveOther(entries: Array<{ label: string | null }>): boolean {
  return entries.some((e) => isOtherStyleOutcomeLabel(e.label));
}

function residualPriceFromNamed(named: number[]): number {
  const sum = named.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0);
  return Number(Math.max(0, 1 - sum).toFixed(4));
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) {
    return null;
  }
  return value as number[];
}

/**
 * Reconcile source outcomeMapping + price vectors with the current entry
 * list. Returns a shallow-patched `source` object when a change is needed,
 * or null when the source is not Polymarket / already aligned / cannot be
 * safely reconciled (e.g. multi-entry edits beyond Other add/remove, or
 * price vectors missing so a mapping-only patch would leave the market
 * unanchorable).
 */
export function reconcileSourceMappingWithEntries(
  source: unknown,
  entries: Array<{ label: string | null }>,
): Record<string, unknown> | null {
  if (!source || typeof source !== "object") return null;
  const src = source as Record<string, unknown>;
  if (src.provider !== "polymarket") return null;

  const mappingRaw = src.outcomeMapping;
  if (!Array.isArray(mappingRaw) || mappingRaw.length < 2) return null;

  const mapping = mappingRaw.map((row) => ({ ...(row as SourceOutcomeMappingRow) }));
  const hasOtherEntry = entriesHaveOther(entries);
  const hasOtherMapping = mappingHasOtherLabel(mapping);

  // Already length-aligned and Other presence matches — nothing to do.
  if (entries.length === mapping.length && hasOtherEntry === hasOtherMapping) {
    return null;
  }

  // Only auto-heal the orphan-Other add/remove cases. Broader entry edits
  // (rename, reorder-only, add named nominee) need a scout re-import.
  const onlyOtherAdded =
    hasOtherEntry &&
    !hasOtherMapping &&
    entries.length === mapping.length + 1;
  const onlyOtherRemoved =
    !hasOtherEntry &&
    hasOtherMapping &&
    entries.length === mapping.length - 1;

  if (!onlyOtherAdded && !onlyOtherRemoved) return null;

  let nextMapping = mapping;
  let nextPricesAtImport = asNumberArray(src.pricesAtImport);
  let nextLivePrices = asNumberArray(src.livePrices);

  if (onlyOtherAdded) {
    // Fail closed: without a length-aligned named price vector we cannot
    // invent a residual slot that readSourceFairByEntryId can consume.
    const canExtendImport =
      nextPricesAtImport != null && nextPricesAtImport.length === mapping.length;
    const canExtendLive =
      nextLivePrices != null && nextLivePrices.length === mapping.length;
    if (!canExtendImport && !canExtendLive) return null;

    const otherLabel =
      entries.find((e) => isOtherStyleOutcomeLabel(e.label))?.label?.trim() ||
      OTHER_OUTCOME_LABEL;
    nextMapping = [
      ...mapping,
      {
        entryLabel: otherLabel,
        sourceLabel: otherLabel,
        sourceMarketId: "",
        sourceOutcomeIndex: 0,
        isResidual: true,
      },
    ];
    if (canExtendImport && nextPricesAtImport) {
      nextPricesAtImport = [
        ...nextPricesAtImport,
        residualPriceFromNamed(nextPricesAtImport),
      ];
    }
    if (canExtendLive && nextLivePrices) {
      nextLivePrices = [
        ...nextLivePrices,
        residualPriceFromNamed(nextLivePrices),
      ];
    }
  } else {
    // onlyOtherRemoved — drop residual/Other mapping row + matching price slot
    const dropIdx = mapping.findIndex((row) => isResidualMappingRow(row));
    if (dropIdx < 0) return null;
    nextMapping = mapping.filter((_, i) => i !== dropIdx);
    if (nextPricesAtImport && nextPricesAtImport.length === mapping.length) {
      nextPricesAtImport = nextPricesAtImport.filter((_, i) => i !== dropIdx);
    }
    if (nextLivePrices && nextLivePrices.length === mapping.length) {
      nextLivePrices = nextLivePrices.filter((_, i) => i !== dropIdx);
    }
  }

  const patched: Record<string, unknown> = {
    ...src,
    outcomeMapping: nextMapping,
  };
  if (nextPricesAtImport) patched.pricesAtImport = nextPricesAtImport;
  if (nextLivePrices) patched.livePrices = nextLivePrices;
  return patched;
}

export type SourceAnchorDesyncReason =
  | "entry_mapping_mismatch"
  | "live_prices_mismatch"
  | "import_prices_mismatch"
  | "unanchorable";

export interface SourceAnchorDesyncRow {
  marketId: string;
  title: string;
  entryCount: number;
  mappingCount: number;
  livePricesCount: number | null;
  importPricesCount: number | null;
  reason: SourceAnchorDesyncReason;
  /** True when readSourceFairByEntryId still returns a usable fair map. */
  anchorable: boolean;
}

/**
 * Detect scouted community markets with source-vector / entry issues.
 *
 * Prefer passing entry labels so we can distinguish healable ±1 desync
 * (still anchorable via tolerant read) from truly unanchorable markets.
 */
export function detectSourceAnchorDesync(
  markets: Array<{
    marketId: string;
    title: string;
    entryCount: number;
    metadata: unknown;
    entries?: Array<{ id: string; label: string | null }>;
  }>,
): SourceAnchorDesyncRow[] {
  const out: SourceAnchorDesyncRow[] = [];
  for (const m of markets) {
    if (!m.metadata || typeof m.metadata !== "object") continue;
    const meta = m.metadata as Record<string, unknown>;
    if (meta.scoutedByMarketScout !== true && meta.scoutedByMarketScout !== "true") {
      continue;
    }
    const source = meta.source;
    if (!source || typeof source !== "object") continue;
    const src = source as Record<string, unknown>;
    if (src.provider !== "polymarket") continue;

    const mapping = Array.isArray(src.outcomeMapping) ? src.outcomeMapping : null;
    if (!mapping) continue;
    const mappingCount = mapping.length;
    const live = Array.isArray(src.livePrices) ? src.livePrices : null;
    const imported = Array.isArray(src.pricesAtImport) ? src.pricesAtImport : null;

    let reason: SourceAnchorDesyncReason | null = null;
    if (m.entryCount !== mappingCount) {
      reason = "entry_mapping_mismatch";
    } else if (live && live.length !== m.entryCount) {
      reason = "live_prices_mismatch";
    } else if (imported && imported.length !== m.entryCount) {
      reason = "import_prices_mismatch";
    }

    const anchorable =
      Array.isArray(m.entries) && m.entries.length > 0
        ? readSourceFairByEntryId(m.metadata, m.entries) != null
        : // Count-only callers: ±1 Other desync is healable; larger gaps aren't.
          Math.abs(m.entryCount - mappingCount) <= 1 &&
          (live?.length === mappingCount || imported?.length === mappingCount);

    if (!reason && Array.isArray(m.entries) && m.entries.length > 0 && !anchorable) {
      reason = "unanchorable";
    }

    if (!reason) continue;

    out.push({
      marketId: m.marketId,
      title: m.title,
      entryCount: m.entryCount,
      mappingCount,
      livePricesCount: live?.length ?? null,
      importPricesCount: imported?.length ?? null,
      reason,
      anchorable,
    });
  }
  return out;
}
