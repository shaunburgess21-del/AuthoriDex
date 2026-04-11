/**
 * Deterministic 4-image selection for curate grids.
 * If fewer than 4 images, returns all; otherwise shuffles via a
 * seed derived from personId + cycleNumber then takes the first 4.
 */
export function selectCurateDisplayImages<T extends { id: string }>(
  personId: string,
  images: T[],
  cycleNumber: number = 0,
): T[] {
  if (images.length < 4) return [...images];
  const seed =
    (personId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) +
      cycleNumber * 97) %
    1000;
  return [...images]
    .sort((a, b) => {
      const hashA = ((a.id.charCodeAt(0) || 0) + seed) % 1000;
      const hashB = ((b.id.charCodeAt(0) || 0) + seed) % 1000;
      return hashA - hashB;
    })
    .slice(0, 4);
}
