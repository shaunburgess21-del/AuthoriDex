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
    />
  );
}
