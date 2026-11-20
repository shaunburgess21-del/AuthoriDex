/**
 * Gesture math for trade buttons.
 *
 * A hover lift (`translate` + `scale` on the card) can move the button
 * out from under the pointer between pointerdown and click, so the
 * browser drops the click. Weekly Up sits on the side that moves away
 * first, which is why Up needed a second tap and Down did not.
 * Committing on pointerup, after capturing the pointer, keeps the
 * gesture even when the card shifts. The click that follows is ignored
 * once pointerup already fired.
 */

export const STABLE_PRESS_SLOP_PX = 12;

export function isStablePress(start: { x: number; y: number } | null, end: { x: number; y: number }, slop = STABLE_PRESS_SLOP_PX): boolean {
  if (!start) return false;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return dx * dx + dy * dy <= slop * slop;
}
