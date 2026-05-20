export type RaceThumbParticipant = {
  name: string;
  avatar: string | null;
};

type RaceEntryLike = {
  id?: string;
  label?: string;
  personId?: string | null;
  person?: {
    name?: string;
    avatar?: string | null;
    trendScore?: number;
    change7d?: number;
    rank?: number;
  } | null;
};

/**
 * Top race entries by weekly percent gain — mirrors PredictPage
 * `hydratedGainers` so carousel thumbs match TopGainerCard leaders.
 */
export function getTopRaceEntries(
  entries: RaceEntryLike[] | null | undefined,
  metadata: { openingScores?: Array<{ personId?: string; score?: number }> } | null | undefined,
  limit = 4,
): RaceThumbParticipant[] {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return [];

  const openingScoresMap = new Map<string, number>();
  const rawOpeningScores = metadata?.openingScores;
  if (Array.isArray(rawOpeningScores)) {
    for (const os of rawOpeningScores) {
      if (os.personId && (os.score ?? 0) > 0) {
        openingScoresMap.set(os.personId, os.score!);
      }
    }
  }

  const ranked = list
    .map((e) => {
      const p = e.person || {};
      const currentScore = Number(p.trendScore || 0);
      const openScore = openingScoresMap.get(e.personId || "");
      const pctGain =
        openScore && openScore > 0
          ? ((currentScore - openScore) / openScore) * 100
          : Number(p.change7d || 0);
      return {
        name: p.name || e.label || "?",
        avatar: p.avatar?.trim() ? p.avatar : null,
        percentGain: Math.round(pctGain * 10) / 10,
      };
    })
    .sort((a, b) => b.percentGain - a.percentGain);

  return ranked.slice(0, limit).map(({ name, avatar }) => ({ name, avatar }));
}
