type NativeMarketCycleLike = {
  bettingCutoff?: string | null;
  endAt?: string | Date | null;
  resolutionDeadline?: string | Date | null;
};

function toIso(input: string | Date | null | undefined): string | null {
  if (!input) return null;
  const d = typeof input === "string" ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Picks one canonical cutoff+resolution pair from native market payloads.
 * Uses the latest resolution deadline so a stray stale OPEN row (old week) does not
 * force the whole Predict UI into RESOLVED when current-week markets are also present.
 */
export function getCanonicalNativeCycle(markets: NativeMarketCycleLike[]): {
  bettingCutoff: string | null;
  resolutionDeadline: string | null;
} {
  const nowMs = Date.now();
  const normalized = markets
    .map((m) => ({
      bettingCutoff: toIso(m.bettingCutoff),
      resolutionDeadline: toIso(m.resolutionDeadline ?? m.endAt),
    }))
    .filter((m) => m.bettingCutoff || m.resolutionDeadline);

  if (normalized.length === 0) {
    return { bettingCutoff: null, resolutionDeadline: null };
  }

  const freshResolutionCandidates = normalized.filter(
    (m) =>
      !!m.resolutionDeadline &&
      new Date(m.resolutionDeadline!).getTime() >= nowMs - 60_000,
  );
  const sourceForResolution = freshResolutionCandidates.length > 0 ? freshResolutionCandidates : normalized;

  const withResolution = sourceForResolution
    .filter((m) => !!m.resolutionDeadline)
    .sort((a, b) => new Date(b.resolutionDeadline!).getTime() - new Date(a.resolutionDeadline!).getTime());

  if (withResolution.length > 0) {
    const chosen = withResolution[0];
    const sameWeekCutoff = normalized.find(
      (m) => m.resolutionDeadline === chosen.resolutionDeadline && m.bettingCutoff,
    )?.bettingCutoff;
    const latestCutoff =
      normalized
        .filter((m) => !!m.bettingCutoff)
        .sort((a, b) => new Date(b.bettingCutoff!).getTime() - new Date(a.bettingCutoff!).getTime())[0]?.bettingCutoff ?? null;
    return {
      bettingCutoff: chosen.bettingCutoff ?? sameWeekCutoff ?? latestCutoff,
      resolutionDeadline: chosen.resolutionDeadline!,
    };
  }

  const latestOnlyCutoff = normalized
    .filter((m) => !!m.bettingCutoff)
    .sort((a, b) => new Date(b.bettingCutoff!).getTime() - new Date(a.bettingCutoff!).getTime())[0]?.bettingCutoff ?? null;

  return {
    bettingCutoff: latestOnlyCutoff,
    resolutionDeadline: null,
  };
}
