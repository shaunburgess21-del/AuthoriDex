import { Check } from "lucide-react";

/**
 * Voted-state chrome for head-to-head matchup photos.
 *
 * Layout-neutral on purpose: opacity, filter, border colour, box-shadow
 * and an absolutely positioned badge. No padding, margin, or border-width
 * changes, so a vote cannot shift the card.
 *
 * Colours are the existing result-bar tokens — left blue-600/400, right
 * amber-500/400 — including the rgba glows, which are those same stops.
 */

export type MatchupSide = "a" | "b";

/** Unpicked side after a vote: ~40% opacity and a light greyscale. */
export const MATCHUP_UNPICKED_CLASS = "opacity-40 grayscale-[0.35]";

/** Coloured edge plus a soft glow. Ring and shadow do not affect layout. */
export function matchupPickedFrameClass(side: MatchupSide): string {
  if (side === "a") {
    return "z-10 border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/60 dark:ring-blue-400/70 shadow-[0_0_18px_-2px_rgba(59,130,246,0.55)] dark:shadow-[0_0_18px_-2px_rgba(96,165,250,0.55)]";
  }
  return "z-10 border-amber-500 dark:border-amber-400 ring-2 ring-amber-500/65 dark:ring-amber-400/70 shadow-[0_0_18px_-2px_rgba(245,158,11,0.6)] dark:shadow-[0_0_18px_-2px_rgba(251,191,36,0.55)]";
}

/** Name-bar wash in the same hue as that side's result bar. */
export function matchupPickedNameBarClass(side: MatchupSide): string {
  if (side === "a") {
    return "bg-blue-100 border-blue-300/80 dark:bg-blue-950/75 dark:border-blue-400/50";
  }
  return "bg-amber-100 border-amber-300/80 dark:bg-amber-950/75 dark:border-amber-400/50";
}

/**
 * Filled tick in the outer top corner of the picked photo.
 * Decorative: the "Your pick" text keeps the accessible name.
 */
export function MatchupPickBadge({
  side,
  testId,
}: {
  side: MatchupSide;
  testId?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={`pointer-events-none absolute top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-md ${
        side === "a"
          ? "left-2 bg-blue-600 shadow-blue-600/45"
          : "right-2 bg-amber-600 shadow-amber-600/45"
      }`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}
