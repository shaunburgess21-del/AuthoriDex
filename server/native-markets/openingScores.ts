export type SnapshotScore = {
  score: number;
  snapshotAt: string;
};

export type OpeningScore = SnapshotScore & {
  personId: string;
};

export function buildOpeningScores(
  personIds: string[],
  snapMap: Map<string, SnapshotScore>,
): OpeningScore[] {
  return personIds
    .map((personId) => ({ personId, snap: snapMap.get(personId) }))
    .filter((row): row is { personId: string; snap: SnapshotScore } => Boolean(row.snap))
    .map((row) => ({
      personId: row.personId,
      score: row.snap.score,
      snapshotAt: row.snap.snapshotAt,
    }));
}
