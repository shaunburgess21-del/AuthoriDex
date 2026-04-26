const RATING_TILE_COLORS: Record<number, string> = {
  1: "#FF0000",
  2: "#FF6D00",
  3: "#FFC400",
  4: "#76FF03",
  5: "#00C853",
};

export function getRatingTileColor(rating: number): string {
  const normalizedRating = Math.max(1, Math.min(5, Math.round(rating)));
  return RATING_TILE_COLORS[normalizedRating] ?? RATING_TILE_COLORS[3];
}
