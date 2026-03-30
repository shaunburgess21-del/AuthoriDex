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
 * We anchor to the earliest valid resolution deadline and keep its matching cutoff.
 */
export function getCanonicalNativeCycle(markets: NativeMarketCycleLike[]): {
  bettingCutoff: string | null;
  resolutionDeadline: string | null;
} {
  const normalized = markets
    .map((m) => ({
      bettingCutoff: toIso(m.bettingCutoff),
      resolutionDeadline: toIso(m.resolutionDeadline ?? m.endAt),
    }))
    .filter((m) => m.bettingCutoff || m.resolutionDeadline);

  if (normalized.length === 0) {
    return { bettingCutoff: null, resolutionDeadline: null };
  }

  const withResolution = normalized
    .filter((m) => !!m.resolutionDeadline)
    .sort((a, b) => new Date(a.resolutionDeadline!).getTime() - new Date(b.resolutionDeadline!).getTime());

  if (withResolution.length > 0) {
    const chosen = withResolution[0];
    const fallbackCutoff = normalized
      .filter((m) => !!m.bettingCutoff)
      .sort((a, b) => new Date(a.bettingCutoff!).getTime() - new Date(b.bettingCutoff!).getTime())[0]?.bettingCutoff ?? null;
    return {
      bettingCutoff: chosen.bettingCutoff ?? fallbackCutoff,
      resolutionDeadline: chosen.resolutionDeadline!,
    };
  }

  const firstCutoff = normalized
    .filter((m) => !!m.bettingCutoff)
    .sort((a, b) => new Date(a.bettingCutoff!).getTime() - new Date(b.bettingCutoff!).getTime())[0]?.bettingCutoff ?? null;

  return {
    bettingCutoff: firstCutoff,
    resolutionDeadline: null,
  };
}
