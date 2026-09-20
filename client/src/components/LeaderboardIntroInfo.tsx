import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { cn } from "@/lib/utils";

const HINT_SEEN_KEY = "voxdex_leaderboard_intro_hint_seen";
/** Long enough to catch the eye on arrival, short enough to never become ambient noise. */
const HINT_DURATION_MS = 10_000;

function hasSeenIntroHint(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(HINT_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markIntroHintSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HINT_SEEN_KEY, "1");
  } catch {
    /* Hint persistence is optional in private browsing. */
  }
}

export function LeaderboardIntroContent() {
  return (
    <div className="space-y-2.5 normal-case tracking-normal">
      <p className="text-sm font-semibold">What am I looking at?</p>
      <p className="text-xs text-muted-foreground">
        A live ranking of the public figures the world is paying the most attention to right now.
      </p>
      <p className="text-xs text-muted-foreground">
        Attention is measured from public signals across the internet, then combined into a single
        Trend Score. The board refreshes through the day, so the order moves.
      </p>
      <p className="text-xs text-muted-foreground">
        You can weigh in too &mdash; tap anyone to rate them, or use{" "}
        <span className="font-medium text-foreground">Vote</span> in the menu bar.
      </p>
      <p className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground/80">
        Tap <span className="font-medium text-foreground">Trend Score</span> below to see how the
        number is calculated.
      </p>
    </div>
  );
}

export function LeaderboardIntroInfoIcon({
  hintEligible = false,
  className,
  testId,
}: {
  /** First-visit pulse is reserved for visitors who haven't been onboarded yet. */
  hintEligible?: boolean;
  className?: string;
  testId: string;
}) {
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!hintEligible || hasSeenIntroHint()) return;
    markIntroHintSeen();
    setPulsing(true);
    const timer = window.setTimeout(() => setPulsing(false), HINT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [hintEligible]);

  const stopPulse = () => setPulsing(false);

  return (
    <TouchTooltip
      content={<LeaderboardIntroContent />}
      side="bottom"
      align="start"
      contentClassName="max-w-[300px]"
      triggerAriaLabel="About the leaderboard"
      showCloseButton
    >
      <span
        className="relative inline-flex items-center justify-center"
        onPointerEnter={stopPulse}
        onFocus={stopPulse}
        onClick={stopPulse}
      >
        {pulsing && (
          <span
            className="pointer-events-none absolute inset-[-3px] animate-ping rounded-full bg-primary/40"
            aria-hidden
          />
        )}
        <Info
          className={cn(
            "relative h-4 w-4 cursor-help",
            pulsing ? "text-primary" : "text-muted-foreground/70",
            className,
          )}
          data-testid={testId}
        />
      </span>
    </TouchTooltip>
  );
}
