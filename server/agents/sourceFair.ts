/**
 * Source-anchored fair value for scouted World Markets.
 *
 * Native markets derive lock-in fair from internal trend scores
 * (`lockInFair.ts`); community markets have no such signal. Scouted
 * markets, however, carry the source market's consensus prices in
 * `metadata.source` — `pricesAtImport` captured at import time and
 * `livePrices` refreshed by the daily source watcher
 * (`server/jobs/market-scout.ts`). Those prices ARE the real world's
 * probability estimate, so they serve as the convergence anchor the
 * arb cohort pushes AMM prices toward.
 *
 * Mapping is LABEL-based, not positional: an admin may reorder or
 * polish entries between import and publish. Every VoxDex entry must
 * match exactly one outcomeMapping row (via entryLabel or sourceLabel,
 * case-insensitive) or the whole anchor is rejected — a wrong anchor
 * is worse than no anchor.
 *
 * Residual "Other" rows (isResidual / catch-all labels) are included in
 * the same length-aligned vectors; the watcher fills their live price as
 * max(0, 1 − Σ named). Manual (non-scouted) markets return null and keep
 * their existing LLM-driven agent behaviour.
 *
 * Tolerance: when an admin toggles Other without syncing the source
 * vectors, we heal the common ±1 desync cases so agents stay live
 * (see `reconcileSourceMappingWithEntries` for the write-path fix).
 */

import { isOtherStyleOutcomeLabel } from "@shared/lib/other-outcome";
import { LOCKIN_FAIR_MAX, LOCKIN_FAIR_MIN } from "./lockInFair";

interface SourceOutcomeMappingRow {
  entryLabel?: unknown;
  sourceLabel?: unknown;
  isResidual?: unknown;
}

export interface SourceFairResult {
  /** Normalized fair probability per VoxDex entry id (sums to 1). */
  fairByEntryId: Record<string, number>;
  /** Which price vector anchored the fair: daily-refreshed live prices
   *  or the import-time snapshot. */
  anchor: "live" | "import";
  /** ISO timestamp of the anchor vector (livePricesAt / fetchedAt). */
  anchorAt: string | null;
}

function readSource(metadata: unknown): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const source = (metadata as Record<string, unknown>).source;
  if (!source || typeof source !== "object") return null;
  return source as Record<string, unknown>;
}

function readPriceVector(value: unknown, expectedLength: number): number[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) return null;
  if (value.some((p) => typeof p !== "number" || !Number.isFinite(p) || p < 0)) return null;
  return value as number[];
}

function isResidualMappingRow(row: SourceOutcomeMappingRow): boolean {
  if (row.isResidual === true) return true;
  return (
    isOtherStyleOutcomeLabel(
      typeof row.entryLabel === "string" ? row.entryLabel : null,
    ) ||
    isOtherStyleOutcomeLabel(
      typeof row.sourceLabel === "string" ? row.sourceLabel : null,
    )
  );
}

function matchEntryForRow(
  row: SourceOutcomeMappingRow,
  entriesByLabel: Map<string, Array<{ id: string }>>,
): { id: string } | null {
  for (const candidate of [row.entryLabel, row.sourceLabel]) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const bucket = entriesByLabel.get(candidate.trim().toLowerCase());
    if (bucket?.length === 1) return bucket[0];
  }
  return null;
}

function clampAndNormalize(
  fairByEntryId: Record<string, number>,
): Record<string, number> | null {
  let sum = 0;
  for (const id of Object.keys(fairByEntryId)) {
    const clamped = Math.min(LOCKIN_FAIR_MAX, Math.max(LOCKIN_FAIR_MIN, fairByEntryId[id]));
    fairByEntryId[id] = clamped;
    sum += clamped;
  }
  if (!(sum > 0)) return null;
  for (const id of Object.keys(fairByEntryId)) {
    fairByEntryId[id] = fairByEntryId[id] / sum;
  }
  return fairByEntryId;
}

/**
 * Resolve the source fair-probability map for a scouted market. Returns
 * null when the market has no usable anchor (not scouted, malformed
 * metadata, entries edited beyond label recognition, degenerate prices).
 */
export function readSourceFairByEntryId(
  metadata: unknown,
  entries: Array<{ id: string; label: string | null }>,
): SourceFairResult | null {
  const source = readSource(metadata);
  if (!source || source.provider !== "polymarket") return null;
  // Once the source resolves upstream, the anchor's job is done — the
  // settlement queue takes over and agents shouldn't keep trading toward
  // a frozen 0/1 vector.
  if (typeof source.upstreamResolvedAt === "string") return null;

  const mapping = source.outcomeMapping;
  if (!Array.isArray(mapping) || mapping.length < 2) return null;

  const entriesByLabel = new Map<string, Array<{ id: string }>>();
  for (const e of entries) {
    const key = (e.label ?? "").trim().toLowerCase();
    if (!key) return null;
    const bucket = entriesByLabel.get(key) ?? [];
    bucket.push(e);
    entriesByLabel.set(key, bucket);
  }

  // Prefer length-aligned price vectors. When Other was toggled without a
  // source sync, prices stay at the pre-toggle length — heal those cases.
  const exactLive = readPriceVector(source.livePrices, mapping.length);
  const exactImport = readPriceVector(source.pricesAtImport, mapping.length);

  // Case A: exact length match (happy path).
  if (entries.length === mapping.length) {
    const prices = exactLive ?? exactImport;
    if (!prices) return null;

    const fairByEntryId: Record<string, number> = {};
    const claimed = new Set<string>();
    for (let i = 0; i < mapping.length; i++) {
      const row = mapping[i] as SourceOutcomeMappingRow;
      const matched = matchEntryForRow(row, entriesByLabel);
      if (!matched || claimed.has(matched.id)) return null;
      claimed.add(matched.id);
      fairByEntryId[matched.id] = prices[i];
    }
    if (claimed.size !== entries.length) return null;

    const normalized = clampAndNormalize(fairByEntryId);
    if (!normalized) return null;
    return {
      fairByEntryId: normalized,
      anchor: exactLive ? "live" : "import",
      anchorAt: exactLive
        ? (typeof source.livePricesAt === "string" ? source.livePricesAt : null)
        : (typeof source.fetchedAt === "string" ? source.fetchedAt : null),
    };
  }

  // Case B: orphan Other entry (entries = mapping + 1). Synthesize residual.
  if (entries.length === mapping.length + 1) {
    const prices = exactLive ?? exactImport;
    if (!prices) return null;

    const otherEntries = entries.filter((e) => isOtherStyleOutcomeLabel(e.label));
    if (otherEntries.length !== 1) return null;
    const orphanOther = otherEntries[0];

    // Mapping must not already include a residual/Other row — that would
    // mean the length mismatch is a different kind of edit.
    if ((mapping as SourceOutcomeMappingRow[]).some((row) => isResidualMappingRow(row))) {
      return null;
    }

    const fairByEntryId: Record<string, number> = {};
    const claimed = new Set<string>();
    let namedSum = 0;
    for (let i = 0; i < mapping.length; i++) {
      const row = mapping[i] as SourceOutcomeMappingRow;
      const matched = matchEntryForRow(row, entriesByLabel);
      if (!matched || claimed.has(matched.id) || matched.id === orphanOther.id) return null;
      claimed.add(matched.id);
      fairByEntryId[matched.id] = prices[i];
      namedSum += prices[i];
    }
    if (claimed.size !== mapping.length) return null;
    fairByEntryId[orphanOther.id] = Math.max(0, 1 - namedSum);

    const normalized = clampAndNormalize(fairByEntryId);
    if (!normalized) return null;
    return {
      fairByEntryId: normalized,
      anchor: exactLive ? "live" : "import",
      anchorAt: exactLive
        ? (typeof source.livePricesAt === "string" ? source.livePricesAt : null)
        : (typeof source.fetchedAt === "string" ? source.fetchedAt : null),
    };
  }

  // Case C: residual mapping row with no matching entry (entries = mapping - 1).
  if (entries.length === mapping.length - 1) {
    const prices = exactLive ?? exactImport;
    if (!prices) return null;

    const residualIndexes = (mapping as SourceOutcomeMappingRow[])
      .map((row, i) => (isResidualMappingRow(row) ? i : -1))
      .filter((i) => i >= 0);
    if (residualIndexes.length !== 1) return null;
    const skipIdx = residualIndexes[0];

    // Confirm the residual row does not match any current entry.
    const residualRow = mapping[skipIdx] as SourceOutcomeMappingRow;
    if (matchEntryForRow(residualRow, entriesByLabel)) return null;

    const fairByEntryId: Record<string, number> = {};
    const claimed = new Set<string>();
    for (let i = 0; i < mapping.length; i++) {
      if (i === skipIdx) continue;
      const row = mapping[i] as SourceOutcomeMappingRow;
      const matched = matchEntryForRow(row, entriesByLabel);
      if (!matched || claimed.has(matched.id)) return null;
      claimed.add(matched.id);
      fairByEntryId[matched.id] = prices[i];
    }
    if (claimed.size !== entries.length) return null;

    const normalized = clampAndNormalize(fairByEntryId);
    if (!normalized) return null;
    return {
      fairByEntryId: normalized,
      anchor: exactLive ? "live" : "import",
      anchorAt: exactLive
        ? (typeof source.livePricesAt === "string" ? source.livePricesAt : null)
        : (typeof source.fetchedAt === "string" ? source.fetchedAt : null),
    };
  }

  return null;
}
