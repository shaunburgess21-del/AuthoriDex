import { Toaster } from "sonner";
import { useThemeToggle } from "@/hooks/useThemeToggle";

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
      /* Symmetric gutters so Sonner's mobile top-center layout doesn't
       * bias the streak card toward one edge (see index.css streak-toast). */
      offset="0.5rem"
      mobileOffset={{ left: "0.5rem", right: "0.5rem", top: "0.5rem" }}
    />
  );
}
