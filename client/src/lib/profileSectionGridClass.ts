/** Center 1–2 cards; use 3-column grid when there are 3+ cards. Mirrors PredictTab `predictSectionGridClass`. */
export function profileSectionGridClass(n: number): { container: string; item: string } {
  if (n <= 0) return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
  if (n === 1) return { container: "flex justify-center", item: "w-full max-w-sm" };
  if (n === 2) return { container: "flex flex-col sm:flex-row flex-wrap justify-center gap-4", item: "w-full max-w-sm" };
  return { container: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4", item: "" };
}
