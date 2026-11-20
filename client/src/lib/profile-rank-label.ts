/** Visible rank chips on a full profile. Category name stays in the label so "#2" is not a second mystery rank. */
export function categoryRankLabel(category: string, rank: number): string {
  const name = category.trim();
  return name ? `${name} #${rank}` : `Category #${rank}`;
}

export function overallRankLabel(rank: number | null | undefined): string {
  if (rank == null || rank <= 0) return "Overall New";
  return `Overall #${rank}`;
}

export function neutralShareLabel(percent: number): string {
  const n = Number.isFinite(percent) ? Math.round(percent) : 0;
  return `Neutral ${n}%`;
}
