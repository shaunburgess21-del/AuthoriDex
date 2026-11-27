import { useEffect } from "react";
import { logFunnelEvent } from "@/lib/funnelTelemetry";
import { requestWelcomeTour } from "@/lib/welcomeTour";

/**
 * Fixed-height illustration inside the welcome checklist. A finger taps one
 * side and the bar fills, on a CSS loop so it keeps running after the
 * checklist finishes opening. No names and no live data. Tapping it starts
 * the tour; the loop never does. Reduced motion is the CSS media query only.
 */
export function WelcomeTourPreview() {
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
        <span className="welcome-tour-preview-bar block h-full rounded-full bg-gradient-to-r from-blue-600 to-blue-400" />
      </span>
      <span
        aria-hidden
        className="welcome-tour-preview-finger pointer-events-none absolute z-10 h-7 w-7 rounded-full border-2 border-foreground/80 bg-background shadow-md"
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
