/**
 * Progressive-enhancement haptic feedback via the Web Vibration API.
 * No-ops silently on unsupported platforms (iOS Safari, older desktops).
 */
export function haptic(pattern: number | number[] = 10) {
  navigator.vibrate?.(pattern);
}

export function hapticSuccess() {
  haptic([10, 30, 10]);
}

export function hapticError() {
  haptic([40, 20, 40]);
}
