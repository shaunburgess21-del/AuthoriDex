/**
 * Largest integer font size in [minFontPx, maxFontPx] whose wrapped block
 * is no taller than maxHeightPx. If even the minimum overflows, returns the
 * minimum — callers must not clip that overflow or words disappear.
 */
export function chooseFontSizeForHeight(
  measureHeight: (fontPx: number) => number,
  minFontPx: number,
  maxFontPx: number,
  maxHeightPx: number,
): number {
  let lo = minFontPx;
  let hi = Math.max(minFontPx, maxFontPx);
  let best = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (measureHeight(mid) <= maxHeightPx) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  while (best > minFontPx && measureHeight(best) > maxHeightPx) best -= 1;
  return best;
}
