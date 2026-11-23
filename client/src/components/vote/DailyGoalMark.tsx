import { Check } from "lucide-react";
import { DAILY_VOTE_GOAL } from "@/lib/dailyVoteGoal";

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 14px ring for the returning-user strip. The dash offset is the progress;
 * the transition is dropped under prefers-reduced-motion. At the goal a
 * check sits in the ring — no celebration.
 */
export function DailyGoalMark({
  count,
  goal = DAILY_VOTE_GOAL,
  done,
  label,
}: {
  count: number;
  goal?: number;
  done: boolean;
  label: string;
}) {
  const pct = goal > 0 ? Math.min(1, Math.max(0, count) / goal) : 0;
  const offset = CIRCUMFERENCE * (1 - pct);
  return (
    <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-3.5 w-3.5 -rotate-90"
        role="img"
        aria-label={label}
        focusable="false"
        data-testid="vote-return-strip-goal-ring"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-muted"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="stroke-cyan-600 transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none dark:stroke-cyan-400"
        />
      </svg>
      {done ? (
        <Check className="absolute h-2 w-2 text-cyan-700 dark:text-cyan-300" aria-hidden />
      ) : null}
    </span>
  );
}
