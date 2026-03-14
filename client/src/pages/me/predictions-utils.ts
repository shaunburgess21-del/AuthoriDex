export type PredictionDirection = "up" | "down" | "neutral";

export function inferPredictionDirection(entryLabel?: string | null): PredictionDirection {
  const label = entryLabel?.trim().toLowerCase() ?? "";

  if (!label) {
    return "neutral";
  }

  const matchesWord = (token: string) => new RegExp(`\\b${token}\\b`).test(label);

  if (["up", "yes", "above", "over", "for"].some(matchesWord)) {
    return "up";
  }

  if (["down", "no", "below", "under", "against"].some(matchesWord)) {
    return "down";
  }

  return "neutral";
}
