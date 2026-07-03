import { type MouseEvent, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "wouter";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { CardImage } from "@/components/ui/card-image";
import { normalizeMarketCategory } from "@shared/constants";
import { CardCommentsFocusOverlay } from "@/components/comments/CardComments";
import { DiscussionButton } from "@/components/comments/DiscussionButton";
import { CATEGORY_CHIP_RADIUS } from "@/lib/filterControlStyles";
import { useMatchupNeutralNudge } from "@/hooks/useMatchupNeutralNudge";
import {
  removeTrackedMatchupNeutralVote,
  trackMatchupNeutralVote,
} from "@/lib/matchup-neutral-nudge";

/** Matchup row shape for VersusCard (Vote page + profile Vote tab). */
export interface VersusCardMatchup {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionAFallbackImage?: string | null;
  optionBText: string;
  optionBImage: string | null;
  optionBFallbackImage?: string | null;
  promptText?: string | null;
  isActive?: boolean;
  visibility?: string;
  featured?: boolean;
  slug: string | null;
  createdAt?: string;
  optionAVotes: number;
  optionBVotes: number;
  neutralVotes?: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
  neutralPercent?: number;
  personAId?: string | null;
  personBId?: string | null;
  relatedPersonIds?: string[];
  commentCount?: number;
}

export function VersusCard({
  matchup,
  userVote,
  onVote,
  onRemoveVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onNavigateToDetail,
  onBrowseFullScreen,
  enableDiscussion = false,
  priority = false,
  enableNeutralNudge = true,
  enableVsShimmer = true,
}: {
  matchup: VersusCardMatchup;
  userVote: string | null;
  onVote: (matchupId: string, option: "option_a" | "option_b" | "neutral", event?: MouseEvent) => void;
  onRemoveVote: (matchupId: string) => void;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onNavigateToDetail?: () => void;
  onBrowseFullScreen?: () => void;
  enableDiscussion?: boolean;
  /** Eagerly load this card's images (active/first visible card). */
  priority?: boolean;
  /** Disable morph/hesitation label (dense scroll lists like View All overlay). */
  enableNeutralNudge?: boolean;
  /** VS button shimmer pulse; enabled on View All even when morph/label are off. */
  enableVsShimmer?: boolean;
}) {
  const hasVoted = userVote !== null;
  const votedA = userVote === "option_a";
  const votedB = userVote === "option_b";
  const votedNeutral = userVote === "neutral";
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const showDiscussion = enableDiscussion && !!matchup.slug;
  const neutralNudge = useMatchupNeutralNudge(matchup.id, hasVoted, {
    morph: enableNeutralNudge,
    hesitation: enableNeutralNudge,
    shimmer: enableVsShimmer,
  });
  const footerBarClass = enableNeutralNudge
    ? "bg-muted/60 dark:bg-[#0B0F1A] backdrop-blur-sm"
    : "bg-muted/60 dark:bg-[#0B0F1A]";
  const vsButtonClassName = `relative h-14 w-14 overflow-hidden rounded-full border-2 flex items-center justify-center shadow-lg transition-all duration-300 ${
    votedNeutral
      ? "bg-gradient-to-br from-slate-500 to-slate-600 dark:from-slate-500 dark:to-slate-600 border-slate-400 dark:border-slate-400 ring-2 ring-slate-400/40 dark:ring-slate-400/40"
      : "bg-gradient-to-br from-muted to-card dark:from-slate-700 dark:to-slate-900 border-border dark:border-slate-500 hover:border-slate-400 dark:hover:border-slate-400 hover:ring-2 hover:ring-slate-300/30 cursor-pointer"
  }`;
  const handleNeutralVote = (e: MouseEvent<HTMLButtonElement>) => {
    if (votedNeutral) return;
    trackMatchupNeutralVote(matchup.id, "neutral");
    onVote(matchup.id, "neutral", e);
  };

  return (
    <div ref={neutralNudge.cardRef} className="relative group h-full">
      <div className="absolute -inset-[1px] rounded-xl border border-[#EFEFEF]/50 transition-opacity pointer-events-none opacity-0 group-hover:opacity-100 hidden md:block" />
      <Card className="relative overflow-visible bg-card dark:bg-[#11151D] border border-border/40 dark:border-0 md:border md:border-border/40 dark:md:border-transparent shadow-sm dark:shadow-none md:shadow-sm group-hover:shadow-lg dark:md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] md:group-hover:shadow-[0_8px_32px_rgba(0,0,0,0.08)] transition-all h-full flex flex-col rounded-[12px] md:rounded-xl min-h-[390px] md:min-h-0">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 via-transparent to-sky-600/5 rounded-lg md:rounded-xl" />

        <div className={`relative pt-4 pb-4 ${hasVoted ? "md:pb-[10px]" : ""} flex flex-col flex-1`}>
          <div className="absolute top-3 right-3 z-10">
            <InteractiveCategoryPill
              category={matchup.category}
              onFilter={() => onFilterCategory(matchup.category)}
              raceMarketId={categoryRaceMap.get(normalizeMarketCategory(matchup.category)) ?? undefined}
              leaderboardCategories={leaderboardCategories}
              detailHref={matchup.slug ? `/vote/matchups/${matchup.slug}` : undefined}
              detailOnNavigate={onNavigateToDetail}
              detailLabel="View Matchup Details"
              onBrowseFullScreen={onBrowseFullScreen}
              data-testid={`badge-matchup-${matchup.id}`}
            />
          </div>
          <div className="flex items-center mb-3 gap-2 px-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
              <span className={hasVoted ? "" : "text-slate-600"}>
                {hasVoted ? `${matchup.totalVotes.toLocaleString("en-US")} votes` : "Votes"}
              </span>
            </div>
          </div>

          <div className={`rounded-t-lg border border-border/40 dark:border-slate-700/30 border-b-0 ${footerBarClass} px-4 py-2 text-center mb-0 mt-[5px]`}>
            {matchup.slug && onNavigateToDetail ? (
              <button
                type="button"
                onClick={onNavigateToDetail}
                className="text-sm font-semibold transition-colors text-foreground/80 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400"
                data-testid={`link-matchup-${matchup.id}`}
              >
                {matchup.promptText || "Who do you prefer?"}
              </button>
            ) : matchup.slug ? (
              <Link
                href={`/vote/matchups/${matchup.slug}`}
                className="text-sm font-semibold transition-colors text-foreground/80 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400"
                data-testid={`link-matchup-${matchup.id}`}
              >
                {matchup.promptText || "Who do you prefer?"}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-foreground/80 dark:text-slate-300">
                {matchup.promptText || "Who do you prefer?"}
              </span>
            )}
          </div>

          <div className="flex items-stretch gap-0 relative">
            <button
              type="button"
              onClick={(e) => {
                if (votedA) return;
                trackMatchupNeutralVote(matchup.id, "option_a");
                onVote(matchup.id, "option_a", e);
              }}
              className={`flex-1 flex flex-col rounded-none border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedA
                    ? "border-blue-400/50 dark:border-slate-300/60 ring-2 ring-blue-500/10 dark:ring-white/15"
                    : "border-border/40 dark:border-slate-700/30 opacity-70 hover:opacity-90 hover:border-foreground/30 dark:hover:border-slate-400/40"
                  : "border-border/50 dark:border-slate-700/50 hover:border-foreground/30 dark:hover:border-slate-400/50"
              }`}
              data-testid={`button-vote-a-${matchup.id}`}
            >
              <div className="relative" style={{ minHeight: "222px" }}>
                {matchup.optionAImage ? (
                  <div className="absolute inset-0">
                    <CardImage
                      src={matchup.optionAImage}
                      alt={matchup.optionAText}
                      priority={priority}
                      width={400}
                      fallbackSrc={matchup.optionAFallbackImage}
                    />
                  </div>
                ) : (
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedA ? "from-blue-100 via-blue-50 to-card dark:from-blue-600/30 dark:via-slate-800 dark:to-slate-900" : "from-muted via-muted/80 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"}`}
                  />
                )}
              </div>
              <div className={`px-2 py-2 ${footerBarClass} border-t border-border/40 dark:border-slate-700/30 text-center`}>
                <span className={`font-semibold text-sm truncate block ${votedA ? "text-blue-600 dark:text-blue-400" : "text-foreground"}`}>
                  {matchup.optionAText}
                </span>
              </div>
            </button>

            <div className="absolute left-1/2 top-[calc(50%-18px)] -translate-x-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1">
              {enableVsShimmer || enableNeutralNudge ? (
                <>
                  {enableNeutralNudge && (
                    <AnimatePresence>
                      {neutralNudge.showHesitationLabel && !hasVoted && (
                        <motion.div
                          initial={neutralNudge.prefersReducedMotion ? false : { opacity: 0, x: "-50%", y: 4, scale: 0.96 }}
                          animate={neutralNudge.prefersReducedMotion ? { opacity: 1, x: "-50%" } : { opacity: 1, x: "-50%", y: 0, scale: 1 }}
                          exit={neutralNudge.prefersReducedMotion ? { opacity: 0, x: "-50%" } : { opacity: 0, x: "-50%", y: 4, scale: 0.96 }}
                          transition={{ duration: neutralNudge.prefersReducedMotion ? 0 : 0.18, ease: "easeOut" }}
                          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 w-max max-w-[210px] rounded-full border border-slate-300/70 bg-card/95 px-2.5 py-1 text-center text-[11px] font-medium leading-tight text-slate-600 shadow-lg backdrop-blur-sm dark:border-slate-600/70 dark:bg-slate-900/95 dark:text-slate-300"
                        >
                          Can't decide? Tap VS to stay neutral
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                  <motion.button
                    type="button"
                    onClick={handleNeutralVote}
                    aria-label="Vote neutral"
                    title="Vote neutral"
                    data-testid={`button-vote-neutral-${matchup.id}`}
                    animate={
                      neutralNudge.showVsShimmer && !neutralNudge.prefersReducedMotion
                        ? {
                            scale: [1, 1.06, 1],
                            boxShadow: [
                              "0 10px 18px rgba(15, 23, 42, 0.22)",
                              "0 0 0 5px rgba(148, 163, 184, 0.28)",
                              "0 10px 18px rgba(15, 23, 42, 0.22)",
                            ],
                          }
                        : { scale: 1 }
                    }
                    transition={{ duration: 0.7, ease: "easeOut" }}
                    className={vsButtonClassName}
                  >
                    <AnimatePresence>
                      {neutralNudge.showVsShimmer && !neutralNudge.prefersReducedMotion && (
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/35 to-transparent"
                          initial={{ x: "-140%" }}
                          animate={{ x: "260%" }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.75, ease: "easeOut" }}
                        />
                      )}
                    </AnimatePresence>
                    <span className={`relative z-10 inline-flex min-w-8 items-center justify-center text-sm md:text-base font-bold ${votedNeutral ? "text-white" : "text-foreground dark:text-slate-200"}`}>
                      {enableNeutralNudge ? (
                        <AnimatePresence mode="wait" initial={false}>
                          {neutralNudge.showMorph ? (
                            <motion.span
                              key="tie"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.92 }}
                              transition={{ duration: 0.18, ease: "easeOut" }}
                            >
                              Tie?
                            </motion.span>
                          ) : (
                            <motion.span
                              key="vs"
                              initial={{ opacity: 0, scale: 0.92 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.92 }}
                              transition={{ duration: 0.18, ease: "easeOut" }}
                            >
                              VS
                            </motion.span>
                          )}
                        </AnimatePresence>
                      ) : (
                        "VS"
                      )}
                    </span>
                  </motion.button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleNeutralVote}
                  aria-label="Vote neutral"
                  title="Vote neutral"
                  data-testid={`button-vote-neutral-${matchup.id}`}
                  className={vsButtonClassName}
                >
                  <span className={`relative z-10 inline-flex min-w-8 items-center justify-center text-sm md:text-base font-bold ${votedNeutral ? "text-white" : "text-foreground dark:text-slate-200"}`}>
                    VS
                  </span>
                </button>
              )}
              {votedNeutral && (
                <span className="text-[9px] font-semibold text-slate-500 dark:text-slate-400 bg-card dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded px-1 py-px leading-none whitespace-nowrap shadow-sm">
                  Your pick
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={(e) => {
                if (votedB) return;
                trackMatchupNeutralVote(matchup.id, "option_b");
                onVote(matchup.id, "option_b", e);
              }}
              className={`flex-1 flex flex-col rounded-none border transition-all duration-300 overflow-hidden cursor-pointer ${
                hasVoted
                  ? votedB
                    ? "border-amber-400/50 dark:border-slate-300/60 ring-2 ring-amber-500/10 dark:ring-white/15"
                    : "border-border/40 dark:border-slate-700/30 opacity-70 hover:opacity-90 hover:border-foreground/30 dark:hover:border-slate-400/40"
                  : "border-border/50 dark:border-slate-700/50 hover:border-foreground/30 dark:hover:border-slate-400/50"
              }`}
              data-testid={`button-vote-b-${matchup.id}`}
            >
              <div className="relative" style={{ minHeight: "222px" }}>
                {matchup.optionBImage ? (
                  <div className="absolute inset-0">
                    <CardImage
                      src={matchup.optionBImage}
                      alt={matchup.optionBText}
                      priority={priority}
                      width={400}
                      fallbackSrc={matchup.optionBFallbackImage}
                    />
                  </div>
                ) : (
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${hasVoted && votedB ? "from-amber-100 via-amber-50 to-card dark:from-amber-700/30 dark:via-slate-800 dark:to-slate-900" : "from-muted via-muted/80 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"}`}
                  />
                )}
              </div>
              <div className={`px-2 py-2 ${footerBarClass} border-t border-border/40 dark:border-slate-700/30 text-center`}>
                <span className={`font-semibold text-sm truncate block ${votedB ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                  {matchup.optionBText}
                </span>
              </div>
            </button>
          </div>

          <div className="mt-auto pt-3 px-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-lg font-bold ${hasVoted ? (votedA ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground dark:text-slate-400") : "text-muted-foreground/50 dark:text-slate-600"}`}
                  >
                    {hasVoted ? `${matchup.optionAPercent}%` : "%"}
                  </span>
                  {hasVoted && votedA && (
                    <Badge variant="outline" className="text-[10px] border-blue-500/50 dark:border-blue-500/40 text-blue-600 dark:text-blue-400 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                </div>
                {hasVoted && (matchup.neutralVotes ?? 0) > 0 && (
                  <span className={`text-xs font-semibold ${votedNeutral ? "text-slate-600 dark:text-slate-300" : "text-muted-foreground dark:text-slate-500"}`}>
                    {matchup.neutralPercent ?? 0}%
                  </span>
                )}
                <div className="flex items-center gap-1.5">
                  {hasVoted && votedB && (
                    <Badge variant="outline" className="text-[10px] border-amber-500/50 dark:border-amber-500/40 text-amber-600 dark:text-amber-400 px-1.5 py-0">
                      Your pick
                    </Badge>
                  )}
                  <span
                    className={`text-lg font-bold ${hasVoted ? (votedB ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground dark:text-slate-400") : "text-muted-foreground/50 dark:text-slate-600"}`}
                  >
                    {hasVoted ? `${matchup.optionBPercent}%` : "%"}
                  </span>
                </div>
              </div>
              <div className={`h-2.5 rounded-full overflow-hidden flex ${hasVoted ? "bg-muted dark:bg-slate-700/50" : "bg-muted/60 dark:bg-slate-700/30"}`}>
                {hasVoted ? (
                  <>
                    <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400" style={{ width: `${matchup.optionAPercent}%` }} />
                    {(matchup.neutralVotes ?? 0) > 0 && (
                      <div className="h-full bg-slate-400 dark:bg-slate-500" style={{ width: `${matchup.neutralPercent ?? 0}%` }} />
                    )}
                    <div className="h-full bg-gradient-to-r from-amber-500 to-amber-600" style={{ width: `${matchup.optionBPercent}%` }} />
                  </>
                ) : (
                  <div className="h-full w-full bg-muted dark:bg-slate-700/40" />
                )}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className={`text-[11px] font-medium ${votedA ? "text-blue-600 dark:text-blue-400" : hasVoted ? "text-slate-500" : "text-slate-600"}`}>
                  {matchup.optionAText}
                </span>
                <span className={`text-[11px] font-medium ${votedB ? "text-amber-600 dark:text-amber-400" : hasVoted ? "text-slate-500" : "text-slate-600"}`}>
                  {matchup.optionBText}
                </span>
              </div>
            </div>
          </div>

          <div className="px-4 mt-2 min-h-7 flex items-center">
            {hasVoted ? (
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0 flex items-center">
                  {showDiscussion ? (
                    <DiscussionButton
                      count={matchup.commentCount}
                      onClick={() => setDiscussionOpen(true)}
                      testId={`button-discussion-matchup-${matchup.id}`}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        removeTrackedMatchupNeutralVote(matchup.id);
                        onRemoveVote(matchup.id);
                      }}
                      className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline-offset-4 hover:underline truncate"
                      data-testid={`button-remove-vote-${matchup.id}`}
                    >
                      Remove vote
                    </button>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex items-center justify-center">
                  {matchup.slug && onNavigateToDetail ? (
                    <button
                      type="button"
                      onClick={onNavigateToDetail}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline truncate"
                      data-testid={`button-view-details-${matchup.id}`}
                    >
                      View details
                    </button>
                  ) : matchup.slug ? (
                    <Link
                      href={`/vote/matchups/${matchup.slug}`}
                      className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline truncate"
                      data-testid={`button-view-details-${matchup.id}`}
                    >
                      View details
                    </Link>
                  ) : null}
                </div>
                <div className="flex-1 min-w-0 flex items-center justify-end">
                  <span
                    className={`px-2 py-0.5 ${CATEGORY_CHIP_RADIUS} text-xs font-medium border truncate max-w-full ${
                      votedA
                        ? "border-blue-500/50 dark:border-blue-500/40 text-blue-600 dark:text-blue-400"
                        : votedB
                          ? "border-amber-500/50 dark:border-amber-500/40 text-amber-600 dark:text-amber-400"
                          : "border-slate-400/50 dark:border-slate-500/40 text-slate-500 dark:text-slate-400"
                    }`}
                    data-testid={`badge-voted-matchup-${matchup.id}`}
                  >
                    {votedA ? matchup.optionAText : votedB ? matchup.optionBText : "Neutral"}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
      {showDiscussion && matchup.slug ? (
        <CardCommentsFocusOverlay
          open={discussionOpen}
          onClose={() => setDiscussionOpen(false)}
          entityType="matchup"
          slug={matchup.slug}
          contextTitle={matchup.title}
        />
      ) : null}
    </div>
  );
}
