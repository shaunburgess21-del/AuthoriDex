/** Apple's minimum control size. The painted control can stay smaller. */
export const MOBILE_TAP_TARGET_PX = 44;

/**
 * Hit box for `.tap-44`: each axis grows to 44px, and an axis that is
 * already larger stays at its visual size (`max(100%, 44px)`).
 */
export function expandedHitBox(
  visual: { width: number; height: number },
  minimum = MOBILE_TAP_TARGET_PX,
): { width: number; height: number } {
  return {
    width: Math.max(visual.width, minimum),
    height: Math.max(visual.height, minimum),
  };
}
