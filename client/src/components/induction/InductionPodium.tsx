import { Check, Crown, Trophy } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS } from "@/lib/sentimentPollVoteDisplay";
import { cn } from "@/lib/utils";
import type { RankedCandidate } from "./types";

interface InductionPodiumProps {
  /** Top three of the active view, best first. */
  leaders: RankedCandidate[];
  label: string;
  isVoted: (id: string) => boolean;
  onOpen: (position: number) => void;
}

const PLACE_STYLES = [
  {
    avatar: "h-24 w-24 sm:h-28 sm:w-28",
    ring: "ring-2 ring-yellow-400/70 shadow-[0_0_32px_-6px] shadow-yellow-400/50",
    step: "h-16 from-yellow-500/30 to-yellow-500/5 border-yellow-500/40 text-yellow-600 dark:text-yellow-300",
  },
  {
    avatar: "h-[72px] w-[72px] sm:h-24 sm:w-24",
    ring: "ring-2 ring-slate-300/50",
    step: "h-11 from-slate-300/25 to-slate-300/5 border-slate-400/40 text-slate-500 dark:text-slate-300",
  },
  {
    avatar: "h-[72px] w-[72px] sm:h-24 sm:w-24",
    ring: "ring-2 ring-orange-400/50",
    step: "h-8 from-orange-500/25 to-orange-500/5 border-orange-500/40 text-orange-600 dark:text-orange-300",
  },
] as const;

/** Visual order on the podium: 2nd, 1st, 3rd. */
const PODIUM_ORDER = [1, 0, 2];

export function InductionPodium({ leaders, label, isVoted, onOpen }: InductionPodiumProps) {
  if (leaders.length < 3) return null;

  return (
    <section className="rounded-2xl border border-border/50 bg-gradient-to-b from-cyan-500/[0.07] via-transparent to-transparent px-4 pt-4 sm:px-6 sm:pt-5">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        <h2 className="text-sm font-semibold">Front-runners</h2>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="mx-auto grid max-w-xl grid-cols-3 items-end gap-2 sm:gap-6">
        {PODIUM_ORDER.map((position) => {
          const candidate = leaders[position];
          const style = PLACE_STYLES[position];
          const voted = isVoted(candidate.id);
          return (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onOpen(position)}
              className="group flex min-w-0 flex-col items-center text-center focus-visible:outline-none"
              data-testid={`podium-induction-${position + 1}`}
            >
              <div className="relative mb-2">
                <div
                  className={cn(
                    "overflow-hidden rounded-2xl transition-transform duration-200 group-hover:-translate-y-1 group-focus-visible:ring-cyan-500 motion-reduce:group-hover:translate-y-0 [&_*]:!rounded-none",
                    style.ring,
                  )}
                >
                  <PersonAvatar
                    name={candidate.displayName}
                    avatar={candidate.avatar}
                    imageSlug={candidate.imageSlug}
                    imageContext="induction"
                    className={cn(style.avatar, "text-lg")}
                  />
                </div>
                {position === 0 && (
                  <span className="absolute -right-2 -top-2 rounded-full bg-yellow-400 p-1 shadow-md">
                    <Crown className="h-3.5 w-3.5 text-yellow-900" fill="currentColor" />
                  </span>
                )}
                {voted && (
                  <span
                    className={cn(
                      "absolute -bottom-1.5 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full shadow-md",
                      SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
                    )}
                    aria-label="You voted"
                  >
                    <Check className="h-3 w-3 text-white" />
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 w-full text-xs font-semibold leading-snug transition-colors group-hover:text-cyan-600 sm:text-sm dark:group-hover:text-cyan-300">
                {candidate.displayName}
              </p>
              <p className="mb-2 text-[11px] tabular-nums text-muted-foreground">
                {candidate.seedVotes.toLocaleString("en-US")} votes
              </p>
              <div
                className={cn(
                  "flex w-full items-start justify-center rounded-t-lg border border-b-0 bg-gradient-to-b pt-1.5 font-mono text-sm font-bold",
                  style.step,
                )}
              >
                {position + 1}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
