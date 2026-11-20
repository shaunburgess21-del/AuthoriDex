import { useEffect, useState, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { Toaster } from "sonner";
import { useThemeToggle } from "@/hooks/useThemeToggle";
import {
  measuredToastTopClearance,
  TOAST_TOP_OFFSET,
  TOAST_Z_INDEX,
} from "@/lib/toastPlacement";
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
 * Wide screens sit below the sticky header and any sticky sub-bar
 * (vote categories, predict filters, voices filters). The toaster's
 * z-index is above that chrome, so a bar cannot paint over the text.
 * Phones sit at the bottom, above the tab bar, plus the safe-area inset
 * from index.css. Dialogs use a higher layer so a card cannot cover Rate.
 */
export function ThemedToaster() {
  const { theme } = useThemeToggle();
  const [location] = useLocation();
  const [position, setPosition] = useState<ToastAnchor>(() =>
    toastPositionForWidth(
      typeof window === "undefined" ? TOAST_DESKTOP_MIN_PX : window.innerWidth,
    ),
  );
  const [topClearance, setTopClearance] = useState<string>(TOAST_TOP_OFFSET);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${TOAST_DESKTOP_MIN_PX}px)`);
    const apply = () => setPosition(toastPositionForWidth(mq.matches ? TOAST_DESKTOP_MIN_PX : 0));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (position !== "top-center") return;
    let frame = 0;
    const measure = () => {
      const next = `${measuredToastTopClearance()}px`;
      setTopClearance((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const late = window.setTimeout(measure, 350);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [position, location]);

  const belowHeader = position === "top-center";
  const offset = belowHeader
    ? { top: topClearance, right: "0.75rem", bottom: "1rem", left: "0.75rem" }
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
