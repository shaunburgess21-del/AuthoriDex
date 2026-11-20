import { Toaster } from "sonner";
import { useThemeToggle } from "@/hooks/useThemeToggle";
import { TOAST_TOP_OFFSET, TOAST_Z_INDEX } from "@/lib/toastPlacement";

/**
 * Sonner defaults to theme="light"; sync with the app's .dark class so
 * custom toasts (StreakToast, BadgeToast) and richColors overrides match
 * the active palette.
 */
export function ThemedToaster() {
  const { theme } = useThemeToggle();

  return (
    <Toaster
      theme={theme}
      richColors
      closeButton
      position="top-center"
      duration={4000}
      swipeDirections={["top", "left", "right"]}
      /* Below the sticky header, and under dialogs (z-50), so a streak
       * toast cannot sit on the Rate control or the 1–5 dialog. */
      offset={{ top: TOAST_TOP_OFFSET }}
      mobileOffset={{ left: "0.5rem", right: "0.5rem", top: TOAST_TOP_OFFSET }}
      style={{ zIndex: TOAST_Z_INDEX }}
    />
  );
}
