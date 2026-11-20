import { useEffect, useState, type CSSProperties } from "react";
import { Toaster } from "sonner";
import { useThemeToggle } from "@/hooks/useThemeToggle";
import { TOAST_TOP_OFFSET, TOAST_Z_INDEX } from "@/lib/toastPlacement";
import {
  TOAST_DESKTOP_MIN_PX,
  TOAST_DURATION_MS,
  TOAST_MOBILE_BOTTOM_OFFSET,
  toastPositionForWidth,
  type ToastAnchor,
} from "@/lib/toast-policy";

/**
 * One toast system.
 *
 * Wide screens sit just below the sticky header and are shifted left of
 * the leaderboard Rate column (see index.css). Phones sit at the bottom,
 * above the tab bar. Both are compact, about 3 seconds, and under dialogs
 * (z-50) so a card cannot cover Rate or a 1–5 dialog.
 *
 * Safe-area insets are added in index.css on top of these offsets
 * (Android writes `--safe-area-inset-*`; the iOS shell maps
 * `env(safe-area-inset-*)` onto the same variables).
 */
export function ThemedToaster() {
  const { theme } = useThemeToggle();
  const [position, setPosition] = useState<ToastAnchor>(() =>
    toastPositionForWidth(
      typeof window === "undefined" ? TOAST_DESKTOP_MIN_PX : window.innerWidth,
    ),
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${TOAST_DESKTOP_MIN_PX}px)`);
    const apply = () => setPosition(toastPositionForWidth(mq.matches ? TOAST_DESKTOP_MIN_PX : 0));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const belowHeader = position === "top-center";
  const offset = belowHeader
    ? { top: TOAST_TOP_OFFSET, right: "0.75rem", bottom: "1rem", left: "0.75rem" }
    : { top: "1rem", right: "0.75rem", bottom: TOAST_MOBILE_BOTTOM_OFFSET, left: "0.75rem" };

  return (
    <Toaster
      theme={theme}
      richColors
      closeButton
      position={position}
      duration={TOAST_DURATION_MS}
      visibleToasts={4}
      gap={8}
      swipeDirections={belowHeader ? ["top", "left", "right"] : ["bottom", "left", "right"]}
      offset={offset}
      mobileOffset={offset}
      style={{ "--width": "320px", zIndex: TOAST_Z_INDEX } as CSSProperties}
    />
  );
}
