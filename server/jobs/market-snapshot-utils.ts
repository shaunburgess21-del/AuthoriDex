export type SnapshotScore = { score: number; capturedAt: Date };

export type MedianCloseSnapshot = SnapshotScore & {
  method: "median" | "single";
  windowHours: number;
  sampleCount: number;
};

/** Max age of last ingest vs endAt when using the close fallback (prevents stale demoted-roster resolves). */
export function getCloseSnapshotFallbackMaxHours(): number {
  const raw = Number(process.env.CLOSE_SNAPSHOT_FALLBACK_MAX_HOURS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 24;
}

/**
 * Trailing-window hours for native close medians (up/down, H2H, gainer).
 *
 * Default 6 matches the 6h opening-score median so open/close are symmetric
 * around the week boundary. Set `NATIVE_CLOSE_MEDIAN_HOURS=1` to restore the
 * legacy single-snapshot close (a 1h window yields ≤1 row → single fallback).
 *
 * `GAINER_CLOSE_MEDIAN_HOURS` is honored as a legacy alias when the native
 * knob is unset, so existing Railway configs keep working.
 */
export function getNativeCloseMedianHours(): number {
  const native = Number(process.env.NATIVE_CLOSE_MEDIAN_HOURS);
  if (Number.isFinite(native) && native >= 1 && native <= 12) {
    return Math.floor(native);
  }
  const gainer = Number(process.env.GAINER_CLOSE_MEDIAN_HOURS);
  if (Number.isFinite(gainer) && gainer >= 1 && gainer <= 12) {
    return Math.floor(gainer);
  }
  return 6;
}

/**
 * Integer median of fame scores. Pure helper for unit tests + resolvers.
 * Empty input returns null; even-length uses the mean of the two middle
 * values, rounded to nearest int (matches gainer close historically).
 */
export function computeMedianFameScore(scores: number[]): number | null {
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length === 0) return null;
  const sorted = valid.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
  }
  return sorted[mid]!;
}

export function ensureDate(val: unknown): Date | null {
  if (val instanceof Date) return val;
  if (val == null) return null;
  const d = new Date(val as string | number);
  if (isNaN(d.getTime())) return null;
  return d;
}

export function getStoredOpeningScore(market: any, personId: string): SnapshotScore | null {
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
