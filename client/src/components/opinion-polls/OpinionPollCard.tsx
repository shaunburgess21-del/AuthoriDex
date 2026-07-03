import { useState, useEffect, useContext, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Images, List, Users, ListChecks, MessageSquare, X } from "lucide-react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { Drawer } from "vaul";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
import { CATEGORY_CHIP_RADIUS } from "@/lib/filterControlStyles";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { CountdownDescription } from "@/components/CountdownDescription";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { isBudgetExhaustedVoteError } from "@/lib/voteErrors";
import { SnapDismissContext } from "@/components/snap-scroll/VoteSnapScrollView";
import { OpinionPollOptionRow, type OpinionPollOptionRowMode } from "@/components/opinion-polls/OpinionPollOptionRow";
import { OpinionPollGalleryOption } from "@/components/opinion-polls/OpinionPollGalleryOption";
import { CardCommentsFocusOverlay } from "@/components/comments/CardComments";
import { sortOpinionPollOptionsForCard } from "@/lib/opinionPollOptions";
import { DiscussionButton } from "@/components/comments/DiscussionButton";
import { ImageLightbox } from "@/components/ImageLightbox";
import { useSupabaseUrl } from "@/lib/imageResolver";
import { useOpinionPollHeaderImage } from "@/lib/opinionPollHeaderImage";

function parseOpinionPollCardError(err: unknown): { message: string; retryAfter?: number } {
  const retryAfter = (err as any)?.retryAfter as number | undefined;
  if (err instanceof Error && err.message) {
    const jsonMatch = err.message.match(/^\d+:\s*(\{[\s\S]*\})\s*$/);
    if (jsonMatch) {
      try {
        const j = JSON.parse(jsonMatch[1]) as { error?: string };
        if (j.error) return { message: j.error, retryAfter };
      } catch {
        /* ignore */
      }
    }
    if (err.message.startsWith("429")) return { message: "Too many votes. Please slow down.", retryAfter: retryAfter ?? 60 };
    return { message: err.message, retryAfter };
  }
  return { message: "Something went wrong. Please try again." };
}

const OPINION_POLL_PREVIEW_COUNT = 4;

/** Poll row shape from `/api/opinion-polls` (Vote + profile Vote tab). */
export interface OpinionPollCardPoll {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  slug: string;
  imageUrl?: string | null;
  totalVotes?: number;
  userVote?: string | null;
  options?: Array<{
    id: string;
    name: string;
    imageUrl?: string | null;
    votes?: number;
    orderIndex?: number;
  }>;
  commentCount?: number;
}

type OpinionPollOption = NonNullable<OpinionPollCardPoll["options"]>[number];
type OptionRowMode = OpinionPollOptionRowMode;
type OptionsViewMode = "list" | "gallery";

export function OpinionPollCard({
  poll,
  onVote,
  onRemoveVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onNavigateToDetail,
  onBrowseFullScreen,
  enableDiscussion = false,
}: {
  poll: OpinionPollCardPoll;
  onVote: (pollSlug: string, optionId: string) => Promise<void>;
  onRemoveVote: (pollSlug: string) => Promise<void>;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onNavigateToDetail?: () => void;
  onBrowseFullScreen?: () => void;
  enableDiscussion?: boolean;
}) {
  const [, setLocation] = useLocation();
  const [voted, setVoted] = useState<string | null>(poll.userVote || null);
  const [discussionOpen, setDiscussionOpen] = useState(false);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [pendingOption, setPendingOption] = useState<{ id: string; name: string } | null>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);
  const [optionsDrawerOpen, setOptionsDrawerOpen] = useState(false);
  const [optionsViewMode, setOptionsViewMode] = useState<OptionsViewMode>("list");
  const [pendingChangeOption, setPendingChangeOption] = useState<typeof options[number] | null>(null);
  const supabaseUrl = useSupabaseUrl();
  const { currentSrc: headerImageSrc, onImageError: onHeaderImageError } = useOpinionPollHeaderImage(
    poll,
    poll.slug,
    supabaseUrl,
  );
  const options = poll.options || [];
  // Once the user has voted, sort options by leader -> trailing so positions
  // update dynamically as votes come in. Pre-vote we keep the authored
  // orderIndex so we don't telegraph popular picks before voting.
  const displayOptions = sortOpinionPollOptionsForCard(options, voted);
  const visibleOptions = displayOptions.slice(0, OPINION_POLL_PREVIEW_COUNT);
  const remainingCount = Math.max(0, options.length - OPINION_POLL_PREVIEW_COUNT);
  const categoryKey = poll.category ?? "";

  useEffect(() => {
    setVoted(poll.userVote ?? null);
  }, [poll.userVote]);

  useEffect(() => {
    if (!optionsDrawerOpen && pendingChangeOption) {
      const t = setTimeout(() => {
        openChangeDialog(pendingChangeOption);
        setPendingChangeOption(null);
      }, 320);
      return () => clearTimeout(t);
    }
  }, [optionsDrawerOpen, pendingChangeOption]);

  useEffect(() => {
    if (optionsDrawerOpen) {
      setOptionsViewMode("list");
    }
  }, [optionsDrawerOpen]);

  const snapDismiss = useContext(SnapDismissContext);
  useEffect(() => {
    if (snapDismiss > 0) {
      setOptionsDrawerOpen(false);
      setExpandedImage(null);
    }
  }, [snapDismiss]);

  const handleVote = async (optionId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!voted) {
      const previousVote = voted;
      setVoted(optionId);
      setOptionsDrawerOpen(false);
      try {
        await onVote(poll.slug, optionId);
      } catch (err) {
        setVoted(poll.userVote ?? previousVote);
        if (isUnauthorizedApiError(err)) {
          toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
        } else if (isBudgetExhaustedVoteError(err)) {
          navigateToLogin(setLocation, {
            mode: "signup",
            reason: "vote_limit_reached",
            resumeAction: {
              surfaceType: "opinion_poll",
              targetId: poll.id,
              cardRoute: window.location.pathname,
              pendingVote: { optionId },
            },
          });
        } else {
          const parsed = parseOpinionPollCardError(err);
          toast.error("Could not record vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
        }
      }
    }
  };

  const openChangeDialog = (option: (typeof options)[0], e?: MouseEvent) => {
    if (e) e.stopPropagation();
    setPendingOption({ id: option.id, name: option.name });
    setChangeDialogOpen(true);
  };

  const handleDrawerChangeVote = (option: (typeof options)[0], e: MouseEvent) => {
    e.stopPropagation();
    setPendingChangeOption(option);
    setOptionsDrawerOpen(false);
  };

  const confirmChangeVote = async () => {
    if (!pendingOption) return;
    try {
      await onVote(poll.slug, pendingOption.id);
      setVoted(pendingOption.id);
      setChangeDialogOpen(false);
      setPendingOption(null);
    } catch (err) {
      if (isUnauthorizedApiError(err)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
      } else if (isBudgetExhaustedVoteError(err)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "opinion_poll",
            targetId: poll.id,
            cardRoute: window.location.pathname,
            pendingVote: pendingOption ? { optionId: pendingOption.id } : undefined,
          },
        });
      } else {
        const parsed = parseOpinionPollCardError(err);
        toast.error("Could not change vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    }
  };

  const handleRemoveVote = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await onRemoveVote(poll.slug);
      setVoted(null);
    } catch (err) {
      if (isUnauthorizedApiError(err)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
      } else if (isBudgetExhaustedVoteError(err)) {
        navigateToLogin(setLocation, {
          mode: "signup",
          reason: "vote_limit_reached",
          resumeAction: {
            surfaceType: "opinion_poll",
            targetId: poll.id,
            cardRoute: window.location.pathname,
            pendingVote: { remove: true },
          },
        });
      } else {
        const parsed = parseOpinionPollCardError(err);
        toast.error("Could not remove vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    }
  };

  const hasVoted = !!voted;
  const showDiscussion = enableDiscussion && !!poll.slug;
  const totalVotes = poll.totalVotes || 0;
  const maxPercent = Math.max(
    ...visibleOptions.map((o) => (totalVotes > 0 ? Math.round(((o.votes ?? 0) / totalVotes) * 100) : 0)),
    0
  );
  const drawerMaxPercent = Math.max(
    ...options.map((o) => (totalVotes > 0 ? Math.round(((o.votes ?? 0) / totalVotes) * 100) : 0)),
    0
  );

  return (
    <div className="relative group h-full overflow-visible">
      <Card
        className={`relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 ${hasVoted ? "md:pb-[10px]" : ""} transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[420px] md:min-h-0 flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:ring-inset md:ring-1 md:ring-transparent md:transition-[box-shadow,ring-color] md:group-hover:ring-[#EFEFEF]/50 md:group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl`}
        data-testid={`opinion-poll-card-${poll.id}`}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 shrink-0 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
            <span className={hasVoted ? "" : "text-slate-600"}>
              {hasVoted ? `${totalVotes.toLocaleString("en-US")} votes` : "Votes"}
            </span>
          </div>
          <InteractiveCategoryPill
            category={categoryKey}
            onFilter={() => onFilterCategory(categoryKey)}
            leaderboardCategories={leaderboardCategories}
            detailHref={poll.slug ? `/vote/opinion-polls/${poll.slug}` : undefined}
            detailOnNavigate={onNavigateToDetail}
            detailLabel="View Poll Details"
            onBrowseFullScreen={onBrowseFullScreen}
            data-testid={`badge-opinion-category-${poll.id}`}
          />
        </div>

        <AvatarHeightHeadline
          className="mb-2"
          text={poll.title}
          serif={false}
          href={onNavigateToDetail ? undefined : `/vote/opinion-polls/${poll.slug}`}
          onTitleNavigate={onNavigateToDetail}
          linkTestId={`link-opinion-detail-${poll.id}`}
          avatar={
            headerImageSrc ? (
              <div
                role="button"
                tabIndex={0}
                aria-label="View larger image"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedImage({ url: headerImageSrc, alt: poll.title });
                }}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setExpandedImage({ url: headerImageSrc, alt: poll.title });
                  }
                }}
                className="h-16 w-16 rounded-md overflow-hidden shrink-0 bg-muted dark:bg-slate-800 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <img
                  src={getDisplayImageUrl(headerImageSrc, { width: 200 })}
                  alt={poll.title}
                  className="w-full h-full object-cover"
                  onError={onHeaderImageError}
                />
              </div>
            ) : (
              <div className="h-16 w-16 rounded-md bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
                <ListChecks className="h-5 w-5 text-slate-400" />
              </div>
            )
          }
        />
        {poll.description && (
          onNavigateToDetail ? (
            <button type="button" onClick={onNavigateToDetail} className="w-full text-left mb-3">
              <p className="text-sm text-muted-foreground line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors cursor-pointer">
                {poll.description}
              </p>
            </button>
          ) : (
            <Link href={`/vote/opinion-polls/${poll.slug}`}>
              <p className="text-sm text-muted-foreground mb-3 line-clamp-2 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors cursor-pointer">
                {poll.description}
              </p>
            </Link>
          )
        )}

        {!hasVoted ? (
          <div className="space-y-1.5">
            {visibleOptions.map((option, idx) => {
              const orderLabel = (option.orderIndex ?? idx) + 1;
              return (
                <OpinionPollOptionRow
                  key={option.id}
                  pollId={poll.id}
                  option={option}
                  orderLabel={orderLabel}
                  mode="vote"
                  onVote={(e) => handleVote(option.id, e)}
                  onExpandImage={(url, alt) => setExpandedImage({ url, alt })}
                  testIdPrefix="opinion-poll-option"
                />
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">
            {visibleOptions.map((option, idx) => {
              const isSelected = voted === option.id;
              const percent = totalVotes > 0 ? Math.round(((option.votes ?? 0) / totalVotes) * 100) : 0;
              const isLeading = percent === maxPercent && percent > 0;
              const orderLabel = (option.orderIndex ?? idx) + 1;
              return (
                <OpinionPollOptionRow
                  key={option.id}
                  pollId={poll.id}
                  option={option}
                  orderLabel={orderLabel}
                  mode={isSelected ? "result-selected" : "result-other"}
                  percent={percent}
                  isLeading={isLeading}
                  onChangeVote={(e) => openChangeDialog(option, e)}
                  onExpandImage={(url, alt) => setExpandedImage({ url, alt })}
                  testIdPrefix="opinion-poll-result"
                />
              );
            })}
          </div>
        )}

        {(hasVoted || remainingCount > 0) && (
          <div className={`${hasVoted ? "mt-auto pt-2.5" : "mt-2.5"} flex items-center gap-2`}>
            <div className="flex-1 min-w-0 flex items-center">
              {hasVoted && showDiscussion ? (
                <DiscussionButton
                  count={poll.commentCount}
                  onClick={() => setDiscussionOpen(true)}
                  testId={`button-discussion-opinion-${poll.id}`}
                />
              ) : hasVoted ? (
                <button
                  type="button"
                  onClick={handleRemoveVote}
                  className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline-offset-4 hover:underline truncate"
                  data-testid={`button-remove-vote-opinion-${poll.id}`}
                >
                  Remove vote
                </button>
              ) : null}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-center">
              {remainingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOptionsDrawerOpen(true)}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline truncate"
                  data-testid={`link-more-options-${poll.id}`}
                >
                  +{remainingCount} more
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-end">
              {hasVoted && (
                <span
                  className={`px-2 py-0.5 ${CATEGORY_CHIP_RADIUS} text-xs font-medium border bg-white/[0.06] border-[#EFEFEF]/35 text-foreground/90 shrink-0`}
                  data-testid={`badge-voted-opinion-${poll.id}`}
                >
                  Voted
                </span>
              )}
            </div>
          </div>
        )}
      </Card>

      <AlertDialog
        open={changeDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            document.addEventListener("click", (e) => e.stopPropagation(), {
              capture: true,
              once: true,
            });
          }
          setChangeDialogOpen(open);
          if (!open) {
            setPendingOption(null);
            setPendingChangeOption(null);
          }
        }}
      >
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Change your vote?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;re switching to{" "}
              <span className="font-medium text-foreground">{pendingOption?.name ?? "this option"}</span>. You can change your vote once per day on
              this poll.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="button" className="bg-cyan-600 hover:bg-cyan-700" onClick={() => void confirmChangeVote()}>
              Change vote
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImageLightbox
        open={!!expandedImage}
        src={expandedImage?.url ?? ""}
        alt={expandedImage?.alt ?? ""}
        onClose={() => setExpandedImage(null)}
      />

      <Drawer.Root
        open={optionsDrawerOpen}
        onOpenChange={setOptionsDrawerOpen}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content
            className={`fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background ${
              optionsViewMode === "gallery" ? "h-[95dvh] max-h-[95dvh]" : "max-h-[85dvh]"
            }`}
            data-interactive="true"
            data-testid={`opinion-poll-options-drawer-${poll.id}`}
          >
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="px-4 pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Drawer.Title className="text-sm font-semibold text-foreground">All options</Drawer.Title>
                  <Drawer.Description className="sr-only">
                    All options for {poll.title}
                  </Drawer.Description>
                  {optionsViewMode === "gallery" ? (
                    <p className="mt-1 text-xs text-muted-foreground">Review large images, then tap one to vote.</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => setOptionsDrawerOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="Close"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="mt-3 flex rounded-lg border border-border/50 bg-muted/30 p-0.5" role="group" aria-label="Option view mode">
                <button
                  type="button"
                  onClick={() => setOptionsViewMode("list")}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    optionsViewMode === "list"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={optionsViewMode === "list"}
                  data-testid={`button-opinion-options-list-${poll.id}`}
                >
                  <List className="h-3.5 w-3.5" />
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setOptionsViewMode("gallery")}
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    optionsViewMode === "gallery"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={optionsViewMode === "gallery"}
                  data-testid={`button-opinion-options-gallery-${poll.id}`}
                >
                  <Images className="h-3.5 w-3.5" />
                  Image review
                </button>
              </div>
            </div>
            <div
              className={
                optionsViewMode === "gallery"
                  ? "flex-1 overflow-y-auto px-3 pb-8 min-h-0 space-y-3 snap-y snap-mandatory overscroll-contain"
                  : "flex-1 overflow-y-auto px-4 pb-2 min-h-0 space-y-1.5"
              }
            >
              {optionsViewMode === "list" ? displayOptions.map((option, idx) => {
                const orderLabel = (option.orderIndex ?? idx) + 1;
                if (!hasVoted) {
                  return (
                    <OpinionPollOptionRow
                      key={option.id}
                      pollId={poll.id}
                      option={option}
                      orderLabel={orderLabel}
                      mode="vote"
                      onVote={(e) => handleVote(option.id, e)}
                      onExpandImage={(url, alt) => setExpandedImage({ url, alt })}
                      testIdPrefix="opinion-poll-drawer-option"
                    />
                  );
                }
                const isSelected = voted === option.id;
                const percent = totalVotes > 0 ? Math.round(((option.votes ?? 0) / totalVotes) * 100) : 0;
                const isLeading = percent === drawerMaxPercent && percent > 0;
                return (
                  <OpinionPollOptionRow
                    key={option.id}
                    pollId={poll.id}
                    option={option}
                    orderLabel={orderLabel}
                    mode={isSelected ? "result-selected" : "result-other"}
                    percent={percent}
                    isLeading={isLeading}
                    onChangeVote={(e) => handleDrawerChangeVote(option, e)}
                    onExpandImage={(url, alt) => setExpandedImage({ url, alt })}
                    testIdPrefix="opinion-poll-drawer-result"
                  />
                );
              }) : displayOptions.map((option, idx) => {
                const orderLabel = (option.orderIndex ?? idx) + 1;
                if (!hasVoted) {
                  return (
                    <OpinionPollGalleryOption
                      key={option.id}
                      pollId={poll.id}
                      option={option}
                      orderLabel={orderLabel}
                      mode="vote"
                      onVote={(e) => handleVote(option.id, e)}
                      testIdPrefix="opinion-poll-gallery-option"
                    />
                  );
                }
                const isSelected = voted === option.id;
                const percent = totalVotes > 0 ? Math.round(((option.votes ?? 0) / totalVotes) * 100) : 0;
                const isLeading = percent === drawerMaxPercent && percent > 0;
                return (
                  <OpinionPollGalleryOption
                    key={option.id}
                    pollId={poll.id}
                    option={option}
                    orderLabel={orderLabel}
                    mode={isSelected ? "result-selected" : "result-other"}
                    percent={percent}
                    isLeading={isLeading}
                    onChangeVote={(e) => handleDrawerChangeVote(option, e)}
                    testIdPrefix="opinion-poll-gallery-result"
                  />
                );
              })}
            </div>
            <div className="border-t border-border/40 px-4 py-3">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setOptionsDrawerOpen(false);
                  if (onNavigateToDetail) {
                    onNavigateToDetail();
                  } else {
                    setLocation(`/vote/opinion-polls/${poll.slug}`);
                  }
                }}
                data-testid={`button-drawer-discussion-${poll.id}`}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                View Details
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {showDiscussion ? (
        <CardCommentsFocusOverlay
          open={discussionOpen}
          onClose={() => setDiscussionOpen(false)}
          entityType="opinion-poll"
          slug={poll.slug}
          contextTitle={poll.title}
        />
      ) : null}
    </div>
  );
}
