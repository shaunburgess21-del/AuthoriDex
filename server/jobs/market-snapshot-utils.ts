export type SnapshotScore = { score: number; capturedAt: Date };

/** Max age of last ingest vs endAt when using the close fallback (prevents stale demoted-roster resolves). */
export function getCloseSnapshotFallbackMaxHours(): number {
  const raw = Number(process.env.CLOSE_SNAPSHOT_FALLBACK_MAX_HOURS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 24;
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
