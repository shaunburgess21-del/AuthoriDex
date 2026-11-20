/**
 * Shared toast timing and placement.
 *
 * Standard toasts stay up for about 3 seconds. Errors stay a little longer
 * so a failure can be read. Rich celebration cards (streak, badge) are a
 * step longer than the default because they carry a timeline, and still
 * well under the old 6–8 second linger.
 *
 * Identical title + description collapse to one toast (same id updates the
 * card in place). Different messages keep their own ids and stack.
 * A React description is left alone — those toasts are not the same message.
 */

export const TOAST_DURATION_MS = 3_000;
export const TOAST_ERROR_DURATION_MS = 5_000;
export const TOAST_RICH_DURATION_MS = 4_000;

/** Matches the `md` breakpoint where the bottom nav hides. */
export const TOAST_DESKTOP_MIN_PX = 768;

/**
 * Clears the mobile bottom nav (h-16) plus a comfortable gap.
 * Safe-area inset is added in CSS so Android's `--safe-area-inset-*`
 * and iOS `env(safe-area-inset-*)` are not baked in twice.
 */
export const TOAST_MOBILE_BOTTOM_OFFSET = "5.5rem";

/**
 * Desktop stays top-center, just under the header and clear of the
 * Rate column. Mobile drops to the bottom so the card clears the tab bar.
 */
export type ToastAnchor = "bottom-center" | "top-center";

export function toastPositionForWidth(width: number): ToastAnchor {
  return width >= TOAST_DESKTOP_MIN_PX ? "top-center" : "bottom-center";
}

export interface ToastPolicyInput {
  id?: string | number;
  duration?: number;
  description?: unknown;
}

export function identicalToastId(
  message: unknown,
  description: unknown,
): string | undefined {
  if (typeof message !== "string" || message.length === 0) return undefined;
  if (description != null && typeof description !== "string") return undefined;
  const desc = typeof description === "string" ? description : "";
  return `vd-same:${hashToastKey(`${message}\n${desc}`)}`;
}

export function resolveToastOptions<T extends ToastPolicyInput | undefined>(
  message: unknown,
  data: T,
  kind: "default" | "error",
): ToastPolicyInput {
  const duration =
    data?.duration ??
    (kind === "error" ? TOAST_ERROR_DURATION_MS : TOAST_DURATION_MS);
  const id = data?.id ?? identicalToastId(message, data?.description);
  return {
    ...(data ?? {}),
    duration,
    ...(id !== undefined ? { id } : {}),
  };
}

function hashToastKey(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
