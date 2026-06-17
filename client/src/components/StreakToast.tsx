import { CalendarCheck, Check, Gift, Sparkles, X } from "lucide-react";
import {
  STREAK_REWARD_TEASE,
  getNextMilestone,
  getStreakToastTimeline,
} from "@/lib/streak-config";

const toastWidth =
  "w-full max-w-[min(384px,calc(100vw-1rem))] sm:max-w-[400px]";

interface StreakToastProps {
  /** Day count after the daily-login bump just applied server-side. */
  currentStreak: number;
  /** All-time peak streak for this user (post-bump). */
  longestStreak?: number;
  /** Sum of daily_login (+ optional milestone or streak_bonus) XP awarded this call. */
  xpAwarded: number;
  /** Server-provided reason string, e.g. "Day 7 milestone". */
  reason: string;
  /** True when today's bump landed on a milestone day (3/7/14/30/100). */
  isMilestone?: boolean;
  /** When isMilestone, which milestone level was hit. */
  milestoneDay?: number;
  /** Sonner-supplied dismiss handler. Wired to the close button. */
  onClose: () => void;
}

/**
 * Headline copy. Distinct treatment on milestone days so the toast
 * reads as a celebration, not a routine "+10 XP". Falls back to a
 * pacing line ("Day N streak") for ordinary days.
 */
function titleFor({
  currentStreak,
  isMilestone,
  milestoneDay,
}: Pick<StreakToastProps, "currentStreak" | "isMilestone" | "milestoneDay">): string {
  if (isMilestone && milestoneDay) {
    return `Day ${milestoneDay} milestone — bonus XP unlocked!`;
  }
  if (currentStreak <= 1) return "Streak started";
  return `Day ${currentStreak} streak`;
}

function timelineAriaLabel(
  slots: number[],
  currentStreak: number,
  giftDay: number | null,
  showGift: boolean,
  pastTopTier: boolean,
  nextMilestone: ReturnType<typeof getNextMilestone>,
): string {
  const range =
    slots.length === 1
      ? `day ${slots[0]}`
      : `days ${slots[0]} through ${slots[slots.length - 1]}`;
  const tail = pastTopTier
    ? "you have reached the top tier"
    : showGift && giftDay !== null
      ? `day ${giftDay} is the next milestone`
      : nextMilestone !== null
        ? `next milestone is day ${nextMilestone}`
        : "";
  return `Streak progress: ${range}, currently day ${currentStreak}${tail ? `, ${tail}` : ""}`;
}

export function StreakToast({
  currentStreak,
  longestStreak,
  xpAwarded,
  reason,
  isMilestone = false,
  milestoneDay,
  onClose,
}: StreakToastProps) {
  const { start, end, giftDay, showGift, pastTopTier } = getStreakToastTimeline(currentStreak);
  const slots: number[] = [];
  for (let d = start; d <= end; d += 1) slots.push(d);

  const beatsBest = longestStreak !== undefined && currentStreak >= longestStreak && currentStreak > 1;
  const nextMilestone = getNextMilestone(currentStreak);
  const daysToNext = nextMilestone ? nextMilestone - currentStreak : null;
  const isToday = (day: number) => !showGift && day === currentStreak;

  const iconPillClasses =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#3C83F6]/15 text-[#3C83F6] dark:bg-[#3C83F6]/20 dark:text-[#93C5FD]";

  // Milestone variant gets a stronger border and sparkle accent so it
  // stands out from the routine daily check-in toast. bg-card keeps the
  // panel opaque; the gradient tints on top (see BadgeToast).
  const containerClasses = isMilestone
    ? `${toastWidth} rounded-2xl border-2 border-[#3C83F6]/60 bg-card bg-gradient-to-br from-[#3C83F6]/15 to-[#3C83F6]/10 shadow-[0_0_24px_rgba(60,131,246,0.25)] p-4 relative`
    : `${toastWidth} rounded-2xl border border-[#3C83F6]/30 bg-card shadow-lg p-4 relative`;

  return (
    <div
      className={containerClasses}
      role="status"
      data-testid="streak-toast"
      data-milestone={isMilestone ? "true" : "false"}
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
        <span className={iconPillClasses}>
          {isMilestone ? <Sparkles className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />}
        </span>
        <div className="space-y-0.5">
          <p className="text-[15px] font-semibold leading-tight">
            {titleFor({ currentStreak, isMilestone, milestoneDay })}
          </p>
          {xpAwarded > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-mono font-semibold text-[#3C83F6] dark:text-[#93C5FD]">
                +{xpAwarded} XP
              </span>{" "}
              · {reason}
            </p>
          )}
        </div>
      </div>

      <div
        className="mt-3.5 mb-1 flex items-start gap-0"
        aria-label={timelineAriaLabel(
          slots,
          currentStreak,
          giftDay,
          showGift,
          pastTopTier,
          nextMilestone,
        )}
      >
        {slots.map((dayNumber, idx) => {
          const isLastSlot = idx === slots.length - 1;
          const isGift = showGift && giftDay !== null && dayNumber === giftDay;
          const isCompleted = dayNumber <= currentStreak;
          const nextCompleted = dayNumber + 1 <= currentStreak;
          const connectorActive = isCompleted && nextCompleted;

          const nodeClasses = isGift
            ? isCompleted
              ? "bg-[#3C83F6] text-white shadow-[0_0_0_3px_rgba(60,131,246,0.25)]"
              : "bg-muted text-muted-foreground"
            : isCompleted
              ? isToday(dayNumber)
                ? "bg-[#3C83F6] text-white ring-2 ring-[#3C83F6]/40 shadow-[0_0_0_3px_rgba(60,131,246,0.18)]"
                : "bg-[#3C83F6] text-white shadow-[0_0_0_3px_rgba(60,131,246,0.18)]"
              : "bg-muted text-muted-foreground/70";

          const giftLabel = `Day ${giftDay}`;

          return (
            <div
              key={dayNumber}
              className={`flex min-w-0 flex-col ${isLastSlot ? "items-center" : "flex-1"}`}
            >
              <div className={`flex h-7 items-center ${isLastSlot ? "" : "w-full"}`}>
                <div
                  className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${nodeClasses}`}
                  data-testid={`streak-dot-${dayNumber}${isGift ? "-gift" : ""}`}
                >
                  {isGift ? (
                    <Gift className="h-3.5 w-3.5" />
                  ) : isCompleted ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : null}
                </div>
                {!isLastSlot && (
                  <div
                    className={`h-[2px] flex-1 ${
                      connectorActive
                        ? "bg-[#3C83F6]/70"
                        : "bg-muted-foreground/25"
                    }`}
                  />
                )}
              </div>
              <span
                className={`mt-1 text-center text-[10px] tabular-nums leading-none ${
                  isGift
                    ? "font-medium text-[#3C83F6] dark:text-[#93C5FD]"
                    : "w-7 truncate text-muted-foreground"
                }`}
                data-testid={`streak-dot-label-${dayNumber}${isGift ? "-gift" : ""}`}
              >
                {isGift ? giftLabel : dayNumber}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1">
        <p className="text-[13px] text-foreground/90">{STREAK_REWARD_TEASE}</p>
        {daysToNext !== null && daysToNext > 0 && !isMilestone && (
          <p className="text-[12px] text-muted-foreground">
            {daysToNext === 1
              ? `1 day to Day ${nextMilestone}.`
              : `${daysToNext} days to Day ${nextMilestone}.`}
          </p>
        )}
        {beatsBest && (
          <p className="text-[12px] text-[#3C83F6] dark:text-[#93C5FD] font-medium">
            New personal best.
          </p>
        )}
      </div>
    </div>
  );
}
