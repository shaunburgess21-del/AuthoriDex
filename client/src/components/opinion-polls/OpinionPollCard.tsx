import { useState, useEffect, useContext, type MouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Users, ListChecks, CheckCircle2, MessageSquare, X } from "lucide-react";
import { Drawer } from "vaul";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { AvatarHeightHeadline } from "@/components/AvatarHeightHeadline";
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
import { SnapDismissContext } from "@/components/snap-scroll/VoteSnapScrollView";

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
}

type OpinionPollOption = NonNullable<OpinionPollCardPoll["options"]>[number];
type OptionRowMode = "vote" | "result-selected" | "result-other";

function OptionRow({
  poll,
  option,
  orderLabel,
  mode,
  percent = 0,
  isLeading = false,
  onVote,
  onChangeVote,
  onExpandImage,
  testIdPrefix,
}: {
  poll: OpinionPollCardPoll;
  option: OpinionPollOption;
  orderLabel: number;
  mode: OptionRowMode;
  percent?: number;
  isLeading?: boolean;
  onVote?: (e: MouseEvent) => void;
  onChangeVote?: (e: MouseEvent) => void;
  onExpandImage: (url: string, alt: string) => void;
  testIdPrefix: string;
}) {
  const imageColumn = option.imageUrl ? (
    <button
      type="button"
      aria-label="View larger image"
      onClick={() => onExpandImage(option.imageUrl!, option.name)}
      className="relative shrink-0 w-14 self-stretch min-h-[2.75rem] cursor-zoom-in border-0 p-0"
    >
      <img src={option.imageUrl} alt={option.name} className="absolute inset-0 h-full w-full object-cover" />
    </button>
  ) : (
    <div className="relative flex shrink-0 w-14 items-center justify-center self-stretch min-h-[2.75rem] bg-cyan-500/15 dark:bg-cyan-500/10">
      <span className="text-xs font-semibold text-cyan-600 dark:text-cyan-400">{orderLabel}</span>
    </div>
  );

  if (mode === "vote") {
    return (
      <div
        className="w-full flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-muted/30 p-0 text-left transition-all duration-200 touch-manipulation [@media(hover:hover)_and_(pointer:fine)]:hover:border-[#EFEFEF]/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:border-white/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/5 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/40 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/25 active:border-[#EFEFEF]/40 active:bg-muted/45 dark:active:border-white/35 dark:active:bg-white/[0.07] active:ring-1 active:ring-inset active:ring-[#EFEFEF]/30 dark:active:ring-white/20"
        data-testid={`${testIdPrefix}-${poll.id}-${option.id}`}
      >
        {imageColumn}
        <button
          type="button"
          onClick={onVote}
          className="flex min-w-0 flex-1 flex-col items-stretch py-1.5 pl-2.5 pr-2 text-left transition-transform active:scale-[0.99]"
        >
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{option.name}</span>
            <span className="shrink-0 text-xs font-mono font-bold text-slate-600">%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-700/50" />
          <p className="text-[10px] text-slate-600 mt-0.5">Votes</p>
        </button>
      </div>
    );
  }

  const isSelected = mode === "result-selected";
  const rowClass = `flex items-stretch overflow-hidden rounded-lg border transition-all duration-300 ${
    isSelected
      ? "border-white/40 dark:border-white/50 border-l-4 border-l-cyan-500 bg-slate-200/60 dark:bg-black/30 ring-1 ring-cyan-500/20 dark:ring-cyan-400/15 ring-inset"
      : "border-border/30 bg-muted/20"
  }`;
  const contentColumn = (
    <div className="flex-1 min-w-0 py-1.5 pl-2.5 pr-2">
      <div className="flex items-center gap-1.5">
        <span className={`min-w-0 flex-1 truncate text-sm ${isSelected ? "font-semibold" : ""}`}>{option.name}</span>
        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400 shrink-0" />}
        <span
          className={`shrink-0 text-xs font-mono font-bold ${
            isLeading ? "text-cyan-600 dark:text-cyan-400" : "text-muted-foreground"
          }`}
        >
          {percent}%
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
        <div
          className="h-full rounded-full bg-cyan-500 transition-all duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {(option.votes || 0).toLocaleString("en-US")} votes
      </p>
    </div>
  );

  if (isSelected) {
    return (
      <div className={rowClass} data-testid={`${testIdPrefix}-${poll.id}-${option.id}`}>
        {imageColumn}
        {contentColumn}
      </div>
    );
  }

  return (
    <div className={`${rowClass} w-full`} data-testid={`${testIdPrefix}-${poll.id}-${option.id}`}>
      {imageColumn}
      <button
        type="button"
        className="min-w-0 flex-1 text-left cursor-pointer rounded-r-md touch-manipulation [@media(hover:hover)_and_(pointer:fine)]:hover:ring-1 [@media(hover:hover)_and_(pointer:fine)]:hover:ring-inset [@media(hover:hover)_and_(pointer:fine)]:hover:ring-[#EFEFEF]/50 dark:[@media(hover:hover)_and_(pointer:fine)]:hover:ring-white/35 active:ring-1 active:ring-inset active:ring-[#EFEFEF]/45 dark:active:ring-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EFEFEF]/40 dark:focus-visible:ring-white/30 border-0 bg-transparent p-0"
        onClick={onChangeVote}
      >
        {contentColumn}
      </button>
    </div>
  );
}

export function OpinionPollCard({
  poll,
  onVote,
  onRemoveVote,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onNavigateToDetail,
  onBrowseFullScreen,
}: {
  poll: OpinionPollCardPoll;
  onVote: (pollSlug: string, optionId: string) => Promise<void>;
  onRemoveVote: (pollSlug: string) => Promise<void>;
  onFilterCategory: (category: string) => void;
  categoryRaceMap: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onNavigateToDetail?: () => void;
  onBrowseFullScreen?: () => void;
}) {
  const [, setLocation] = useLocation();
  const [voted, setVoted] = useState<string | null>(poll.userVote || null);
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);
  const [pendingOption, setPendingOption] = useState<{ id: string; name: string } | null>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; alt: string } | null>(null);
  const [optionsDrawerOpen, setOptionsDrawerOpen] = useState(false);
  const [pendingChangeOption, setPendingChangeOption] = useState<typeof options[number] | null>(null);
  const options = poll.options || [];
  // Once the user has voted, sort options by leader -> trailing so positions
  // update dynamically as votes come in. Pre-vote we keep the authored
  // orderIndex so we don't telegraph popular picks before voting.
  const sortedOptions = [...options].sort(
    (a, b) => (b.votes ?? 0) - (a.votes ?? 0) || (a.orderIndex ?? 0) - (b.orderIndex ?? 0)
  );
  const displayOptions = voted ? sortedOptions : options;
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
      try {
        await onVote(poll.slug, optionId);
        setVoted(optionId);
      } catch (err) {
        if (isUnauthorizedApiError(err)) {
          toast(signInToVoteTitle, signInToVoteToastOptions(() => setLocation("/login")));
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
      } else {
        const parsed = parseOpinionPollCardError(err);
        toast.error("Could not remove vote", { description: parsed.retryAfter ? <CountdownDescription seconds={parsed.retryAfter} text={parsed.message} /> : parsed.message });
      }
    }
  };

  const hasVoted = !!voted;
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
        className="relative pt-5 px-4 sm:px-5 pb-4 sm:pb-5 transition-all duration-200 bg-card/80 backdrop-blur-sm h-full min-h-[420px] md:min-h-0 flex flex-col border-0 md:border md:border-transparent shadow-none md:shadow-sm group-hover:shadow-lg md:ring-inset md:ring-1 md:ring-transparent md:transition-[box-shadow,ring-color] md:group-hover:ring-[#EFEFEF]/50 md:group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] rounded-[12px] md:rounded-xl"
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
            poll.imageUrl ? (
              <button
                type="button"
                aria-label="View larger image"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedImage({ url: poll.imageUrl!, alt: poll.title });
                }}
                className="h-14 w-14 rounded-lg overflow-hidden shrink-0 bg-muted dark:bg-slate-800 cursor-zoom-in border-0 p-0"
              >
                <img src={poll.imageUrl} alt={poll.title} className="w-full h-full object-cover" />
              </button>
            ) : (
              <div className="h-14 w-14 rounded-lg bg-gradient-to-br from-slate-700/50 to-slate-800/50 flex items-center justify-center shrink-0">
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
                <OptionRow
                  key={option.id}
                  poll={poll}
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
                <OptionRow
                  key={option.id}
                  poll={poll}
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
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 min-w-0">
              {hasVoted && (
                <button
                  type="button"
                  onClick={handleRemoveVote}
                  className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline-offset-4 hover:underline truncate"
                  data-testid={`button-remove-vote-opinion-${poll.id}`}
                >
                  Remove vote
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 text-center">
              {remainingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOptionsDrawerOpen(true)}
                  className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline truncate"
                  data-testid={`link-more-options-${poll.id}`}
                >
                  +{remainingCount} more options
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0 flex justify-end">
              {hasVoted && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium border bg-white/[0.06] border-[#EFEFEF]/35 text-foreground/90 shrink-0"
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

      {expandedImage && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          data-interactive="true"
          onClick={(e) => {
            e.stopPropagation();
            setExpandedImage(null);
          }}
        >
          <button
            type="button"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedImage(null);
            }}
            aria-label="Close"
          >
            <X className="h-6 w-6 text-white" />
          </button>
          <img
            src={expandedImage.url}
            alt={expandedImage.alt}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <Drawer.Root
        open={optionsDrawerOpen}
        onOpenChange={setOptionsDrawerOpen}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/40" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-[70] flex flex-col rounded-t-2xl border-t border-border/50 bg-background max-h-[85dvh]"
            data-interactive="true"
            data-testid={`opinion-poll-options-drawer-${poll.id}`}
          >
            <div className="mx-auto mt-3 mb-2 h-1.5 w-16 rounded-full bg-muted-foreground/60" />
            <div className="flex items-center justify-between px-4 pb-2">
              <Drawer.Title className="text-sm font-semibold text-foreground">All options</Drawer.Title>
              <Drawer.Description className="sr-only">
                All options for {poll.title}
              </Drawer.Description>
              <button
                type="button"
                onClick={() => setOptionsDrawerOpen(false)}
                className="p-1.5 rounded-lg hover:bg-muted/60 transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-2 min-h-0 space-y-1.5">
              {displayOptions.map((option, idx) => {
                const orderLabel = (option.orderIndex ?? idx) + 1;
                if (!hasVoted) {
                  return (
                    <OptionRow
                      key={option.id}
                      poll={poll}
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
                  <OptionRow
                    key={option.id}
                    poll={poll}
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
                View discussion
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
