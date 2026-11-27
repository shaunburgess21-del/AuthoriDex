import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { logFunnelEvent } from "@/lib/funnelTelemetry";
import { requestWelcomeTour } from "@/lib/welcomeTour";

const CYCLE_S = 10;

function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduce(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

/**
 * Fixed-height illustration inside the welcome checklist. A finger taps one
 * side and the bar fills. No names and no live data. Tapping it starts the
 * tour; the loop never does.
 */
export function WelcomeTourPreview() {
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    logFunnelEvent("tour_preview_viewed", "vote");
  }, []);

  return (
    <button
      type="button"
      data-testid="vote-welcome-tour-preview"
      aria-label="Show me how. Play the welcome tour."
      onClick={() => {
        logFunnelEvent("tour_preview_tapped", "vote");
        requestWelcomeTour("preview");
      }}
      className="relative h-full w-full overflow-hidden rounded-xl border border-cyan-500/30 bg-card text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-cyan-400/25"
    >
      <span className="sr-only">Practice preview. Nothing here is a real vote.</span>
      <span className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-center gap-2" aria-hidden>
        <SideBlock tone="blue" />
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold tracking-wide text-muted-foreground">
          VS
        </span>
        <SideBlock tone="amber" />
      </span>
      <span className="pointer-events-none absolute inset-x-4 bottom-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {reduce ? (
          <motion.span
            className="block h-full w-[68%] rounded-full bg-gradient-to-r from-blue-600 to-blue-400"
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: CYCLE_S, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          <motion.span
            className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400"
            initial={false}
            animate={{ width: ["12%", "12%", "12%", "68%", "68%", "12%"] }}
            transition={{
              duration: CYCLE_S,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.28, 0.36, 0.52, 0.78, 1],
            }}
          />
        )}
      </span>
      <motion.span
        aria-hidden
        className="pointer-events-none absolute z-10 h-7 w-7 rounded-full border-2 border-foreground/80 bg-background shadow-md"
        initial={false}
        animate={
          reduce
            ? { left: "22%", top: "46%", opacity: [0.35, 0.9, 0.35], scale: 1 }
            : {
                left: ["58%", "58%", "22%", "22%", "22%", "58%"],
                top: ["68%", "68%", "42%", "48%", "42%", "68%"],
                scale: [1, 1, 1, 0.86, 1, 1],
                opacity: [0, 1, 1, 1, 0, 0],
              }
        }
        transition={{
          duration: CYCLE_S,
          repeat: Infinity,
          ease: "easeInOut",
          times: reduce ? undefined : [0, 0.12, 0.32, 0.38, 0.72, 1],
        }}
      />
    </button>
  );
}

function SideBlock({ tone }: { tone: "blue" | "amber" }) {
  return (
    <span className="flex h-14 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-2">
      <span
        className={
          tone === "blue"
            ? "h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-blue-400 to-blue-600"
            : "h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-amber-300 to-amber-600"
        }
      />
      <span className="h-2 min-w-0 flex-1 rounded-full bg-foreground/15" />
    </span>
  );
}
