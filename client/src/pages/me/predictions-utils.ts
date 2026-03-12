export type PredictionDirection = "up" | "down" | "neutral";

export function inferPredictionDirection(entryLabel?: string | null): PredictionDirection {
  const label = entryLabel?.trim().toLowerCase() ?? "";

  if (!label) {
    return "neutral";
  }

  if (["up", "yes", "above", "over", "for"].some((token) => label.includes(token))) {
    return "up";
  }

  if (["down", "no", "below", "under", "against"].some((token) => label.includes(token))) {
    return "down";
  }

  return "neutral";
}
