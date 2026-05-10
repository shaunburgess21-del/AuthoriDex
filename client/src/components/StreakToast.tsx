import { Check, Flame, Gift, X } from "lucide-react";
import {
  STREAK_MILESTONE_DAYS,
  STREAK_REWARD_TEASE,
  STREAK_TARGET_DAYS,
  STREAK_TARGET_REWARD_COPY,
} from "@/lib/streak-config";

interface StreakToastProps {
  /** Day count after the daily-login bump just applied server-side. */
  currentStreak: number;
  /** Sum of daily_login (+ optional streak_bonus) XP awarded this call. */
  xpAwarded: number;
  /** Server-provided reason string, e.g. "Daily login + streak bonus". */
  reason: string;
  /** Sonner-supplied dismiss handler. Wired to the close button. */
  onClose: () => void;
}

function titleFor(streak: number): string {
  if (streak <= 1) return "Streak started";
  if (STREAK_MILESTONE_DAYS.includes(streak)) {
    return `${streak}-day streak — nice run`;
  }
  return `Day ${streak} streak`;
}

export function StreakToast({
  currentStreak,
  xpAwarded,
  reason,
  onClose,
}: StreakToastProps) {
  const target = STREAK_TARGET_DAYS;
  // Position within the current cycle (1..target). After completing a cycle
  // we wrap so the dot row stays meaningful for streak > target.
  const cyclePosition = ((currentStreak - 1) % target) + 1;
  const completed = Math.min(cyclePosition, target);
  // Last node is the gift / reward; treat it as "checked" only once the user
  // has fully closed out the cycle.
  const giftEarned = cyclePosition >= target;

  return (
    <div
      className="w-[340px] sm:w-[360px] rounded-2xl border border-orange-500/30 bg-card shadow-lg p-4 relative"
      role="status"
      data-testid="streak-toast"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss streak toast"
        className="absolute top-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="streak-toast-close"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex items-start gap-2.5 pr-6">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-orange-500 dark:bg-orange-500/20 dark:text-orange-300">
          <Flame className="h-4 w-4" />
        </span>
        <div className="space-y-0.5">
          <p className="text-[15px] font-semibold leading-tight">
            {titleFor(currentStreak)}
          </p>
          {xpAwarded > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                +{xpAwarded} XP
              </span>{" "}
              · {reason}
            </p>
          )}
        </div>
      </div>

      <div
        className="mt-3.5 mb-1 flex items-center gap-0"
        aria-label={`Streak progress: ${completed} of ${target} days`}
      >
        {Array.from({ length: target }).map((_, idx) => {
          const dayNumber = idx + 1;
          const isLast = dayNumber === target;
          const isCompleted = dayNumber <= completed;
          // Connector sits to the right of every node except the last. It's
          // active only when BOTH bookend nodes are completed (so a half-done
          // streak draws a half-coloured chain).
          const nextCompleted = dayNumber + 1 <= completed;
          const connectorActive = isCompleted && nextCompleted;

          const nodeClasses = isLast
            ? giftEarned
              ? "bg-orange-500 text-white shadow-[0_0_0_3px_rgba(249,115,22,0.18)]"
              : "bg-muted text-muted-foreground"
            : isCompleted
              ? "bg-orange-500 text-white shadow-[0_0_0_3px_rgba(249,115,22,0.18)]"
              : "bg-muted text-muted-foreground/70";

          return (
            <div
              key={dayNumber}
              className={`flex items-center ${isLast ? "" : "flex-1"}`}
            >
              <div
                className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${nodeClasses}`}
                data-testid={`streak-dot-${dayNumber}${isLast ? "-gift" : ""}`}
              >
                {isLast ? (
                  <Gift className="h-3.5 w-3.5" />
                ) : isCompleted ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : null}
              </div>
              {!isLast && (
                <div
                  className={`h-[2px] flex-1 ${
                    connectorActive
                      ? "bg-orange-500/70"
                      : "bg-muted-foreground/25"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-[13px] text-foreground/90">{STREAK_REWARD_TEASE}</p>
        {currentStreak < target && (
          <p className="text-[12px] text-muted-foreground">
            {STREAK_TARGET_REWARD_COPY}
          </p>
        )}
      </div>
    </div>
  );
}
