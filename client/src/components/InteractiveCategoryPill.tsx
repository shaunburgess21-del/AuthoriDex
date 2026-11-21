import { useCallback, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Filter, Trophy, Users, ExternalLink, Maximize2, ChevronDown, Share2, ThumbsUp, ThumbsDown, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { getMarketCategoryLabel, normalizeMarketCategory, type CardReactionType } from "@shared/constants";
import { getCategoryStyle, CategoryPill } from "@/components/CategoryPill";
import { CATEGORY_CHIP_RADIUS, POLL_CARD_PILL_SIZE_CLASSES } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { signInToVoteToastOptions } from "@/lib/signInToVoteToast";
import { useHideCard } from "@/hooks/useHideCard";
import { useHideHint } from "@/hooks/useHideHint";
import { HideHintBubble, HideHintChipGlow } from "@/components/hide-hint/HideHintBubble";
import {
  cardReactionKey,
  useCardReactionMutation,
  useCardReactionsMap,
  type CardReactionTarget,
} from "@/hooks/useCardReactions";
import {
  sharePage,
  resolveShareUrl,
  type CardShareConfig,
} from "@/lib/share";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  beginCategoryPillBrowsePress,
  cancelCategoryPillBrowsePress,
  commitCategoryPillBrowse,
  consumeCategoryPillBrowseIntent,
  hasCategoryPillBrowseIntent,
  isBrowseTapWithinSlop,
  isCategoryPillDrawerDismissSuppressed,
  markCategoryPillPassiveDismiss,
} from "@/lib/categoryPillBrowseIntent";

export { consumeCategoryPillBrowseIntent, isCategoryPillDrawerDismissSuppressed };

const SIZE_CLASSES = {
  default: "px-2 py-0.5 text-[10px]",
  sm: "px-1 py-0.5 text-[9px] leading-none font-medium",
  pollCard: POLL_CARD_PILL_SIZE_CLASSES,
} as const;

interface InteractiveCategoryPillProps {
  category: string;
  onFilter: () => void;
  raceMarketId?: string | null;
  leaderboardCategories?: Set<string>;
  detailHref?: string;
  /** When set (e.g. Vote page list context), runs instead of navigating via detailHref Link. */
  detailOnNavigate?: () => void;
  detailLabel?: string;
  /** When set, replaces the "View on Leaderboard" option with "Browse {label} Full Screen". */
  onBrowseFullScreen?: () => void;
  /** When true, render a static label chip (e.g. snap view — no drawer/menu). */
  menuDisabled?: boolean;
  /** When set, adds a Share row that mirrors the card's detail-page share link. */
  share?: CardShareConfig;
  /**
   * When set, adds a Like/Dislike ("More/Less like this") row to the menu.
   * Reactions personalize card ordering and feed card-type analytics.
   */
  reactionTarget?: CardReactionTarget;
  /** Override display label (e.g. from category registry: "Media & Podcast"). */
  displayLabel?: string;
  /** Registry-resolved canonical id for colour (e.g. `media` for renamed labels). */
  canonicalId?: string;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  "data-testid"?: string;
}

function MenuItems({
  label,
  category,
  raceMarketId,
  leaderboardCategories,
  detailHref,
  detailLabel,
  onDetailNavigate,
  onFilter,
  onBrowseFullScreen,
  onBrowseIntentStart,
  onBrowsePointerUp,
  onBrowseTouchEnd,
  onBrowsePointerCancel,
  share,
  sharerUserId,
  reaction,
  onReact,
  onHide,
  CloseWrapper,
}: {
  label: string;
  category: string;
  raceMarketId?: string | null;
  leaderboardCategories?: Set<string>;
  detailHref?: string;
  detailLabel?: string;
  onDetailNavigate?: () => void;
  onFilter: () => void;
  onBrowseFullScreen?: () => void;
  onBrowseIntentStart?: (event: React.PointerEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => void;
  onBrowsePointerUp?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onBrowseTouchEnd?: (event: React.TouchEvent<HTMLButtonElement>) => void;
  onBrowsePointerCancel?: () => void;
  share?: CardShareConfig;
  sharerUserId?: string | null;
  /** Current Like/Dislike state for this card (null = none). */
  reaction?: CardReactionType | null;
  /** When set, renders the "More/Less like this" row. */
  onReact?: (reaction: CardReactionType) => void;
  /** When set, renders "Hide card" at the bottom of the menu. */
  onHide?: () => void;
  CloseWrapper: React.ComponentType<{ children: React.ReactNode; asChild?: boolean }>;
}) {
  const showLeaderboard = !leaderboardCategories || leaderboardCategories.has(normalizeMarketCategory(category));

  return (
    <div className="flex flex-col gap-1 py-1">
      <CloseWrapper asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/80 transition-colors"
          onClick={onFilter}
        >
          <Filter className="h-4 w-4 opacity-60 shrink-0" />
          Filter by {label}
        </button>
      </CloseWrapper>

      {raceMarketId && (
        <CloseWrapper asChild>
          <Link
            href={`/predict/race/${raceMarketId}`}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/80 transition-colors no-underline text-foreground"
          >
            <Trophy className="h-4 w-4 opacity-60 shrink-0" />
            View {label} Race
          </Link>
        </CloseWrapper>
      )}

      {(detailHref || onDetailNavigate) && (
        onDetailNavigate ? (
          <CloseWrapper asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/80 transition-colors text-foreground"
              onClick={onDetailNavigate}
            >
              <ExternalLink className="h-4 w-4 opacity-60 shrink-0" />
              {detailLabel || "View Details"}
            </button>
          </CloseWrapper>
        ) : (
          <CloseWrapper asChild>
            <Link
              href={detailHref!}
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/80 transition-colors no-underline text-foreground"
            >
              <ExternalLink className="h-4 w-4 opacity-60 shrink-0" />
              {detailLabel || "View Details"}
            </Link>
          </CloseWrapper>
        )
      )}

      {share && (
        <CloseWrapper asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/80 transition-colors text-foreground"
            onClick={() => {
              void sharePage(share.title, {
                sharerUserId,
                surface: share.surface,
                url: resolveShareUrl(share.path),
              });
            }}
          >
            <Share2 className="h-4 w-4 opacity-60 shrink-0" />
            Share
          </button>
        </CloseWrapper>
      )}

      {onBrowseFullScreen ? (
        <CloseWrapper asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/80 transition-colors text-foreground"
            onPointerDown={onBrowseIntentStart}
            onTouchStart={onBrowseIntentStart}
            onPointerUp={onBrowsePointerUp}
            onTouchEnd={onBrowseTouchEnd}
            onPointerCancel={onBrowsePointerCancel}
            onClick={onBrowseFullScreen}
          >
            <Maximize2 className="h-4 w-4 opacity-60 shrink-0" />
            Browse {label} Full Screen
          </button>
        </CloseWrapper>
      ) : showLeaderboard ? (
        <CloseWrapper asChild>
          <Link
            href={`/rankings?category=${encodeURIComponent(label)}#leaderboard`}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/80 transition-colors no-underline text-foreground"
          >
            <Users className="h-4 w-4 opacity-60 shrink-0" />
            View {label} on Leaderboard
          </Link>
        </CloseWrapper>
      ) : null}

      {onReact && (
        <div
          className="mt-1 pt-1.5 border-t border-border/40 flex items-center gap-1"
          role="group"
          aria-label="Card feedback"
        >
          <CloseWrapper asChild>
            <button
              type="button"
              aria-pressed={reaction === "like"}
              className={cn(
                "group/like flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-sm rounded-md transition-colors",
                reaction === "like"
                  ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                  : "text-foreground hover:bg-muted/60 hover:text-green-600 dark:hover:text-green-400",
              )}
              onClick={() => onReact("like")}
            >
              <ThumbsUp className={cn("h-4 w-4 shrink-0 transition-opacity", reaction === "like" ? "opacity-100" : "opacity-60 group-hover/like:opacity-100")} />
              More like this
            </button>
          </CloseWrapper>
          <CloseWrapper asChild>
            <button
              type="button"
              aria-pressed={reaction === "dislike"}
              className={cn(
                "group/dislike flex flex-1 items-center justify-center gap-2 px-3 py-2.5 text-sm rounded-md transition-colors",
                reaction === "dislike"
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "text-foreground hover:bg-muted/60 hover:text-red-600 dark:hover:text-red-400",
              )}
              onClick={() => onReact("dislike")}
            >
              <ThumbsDown className={cn("h-4 w-4 shrink-0 transition-opacity", reaction === "dislike" ? "opacity-100" : "opacity-60 group-hover/dislike:opacity-100")} />
              Less like this
            </button>
          </CloseWrapper>
        </div>
      )}

      {onHide && (
        <CloseWrapper asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/80 transition-colors text-foreground"
            onClick={onHide}
            data-testid="menu-hide-card"
          >
            <EyeOff className="h-4 w-4 opacity-60 shrink-0" />
            Hide card
          </button>
        </CloseWrapper>
      )}
    </div>
  );
}

export function InteractiveCategoryPill({
  category,
  onFilter,
  raceMarketId,
  leaderboardCategories,
  detailHref,
  detailOnNavigate,
  detailLabel,
  onBrowseFullScreen,
  menuDisabled = false,
  share,
  reactionTarget,
  displayLabel,
  canonicalId,
  size = "default",
  className = "",
  "data-testid": testId,
}: InteractiveCategoryPillProps) {
  const [open, setOpen] = useState(false);
  const pendingBrowseFullScreenRef = useRef(false);
  const browseOriginRef = useRef<{ x: number; y: number } | null>(null);
  const browseTapRejectedRef = useRef(false);
  const onBrowseFullScreenRef = useRef(onBrowseFullScreen);
  onBrowseFullScreenRef.current = onBrowseFullScreen;
  const flushPendingBrowseFullScreenRef = useRef(() => {});
  flushPendingBrowseFullScreenRef.current = () => {
    // Two frames: let the drawer overlay finish retargeting the pointer
    // release before the snap view mounts under that point.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!pendingBrowseFullScreenRef.current) return;
        pendingBrowseFullScreenRef.current = false;
        onBrowseFullScreenRef.current?.();
      });
    });
  };
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const hideHint = useHideHint({
    track: !menuDisabled && !!reactionTarget,
    cardId: reactionTarget ? `${reactionTarget.surfaceType}:${reactionTarget.targetId}` : null,
  });
  const reactionsMap = useCardReactionsMap();
  const reactionMutation = useCardReactionMutation();
  const hideCard = useHideCard();
  const style = getCategoryStyle(category, canonicalId);
  const sizeClass = SIZE_CLASSES[size];
  const label = displayLabel ?? getMarketCategoryLabel(category);

  const currentReaction = reactionTarget
    ? reactionsMap.get(cardReactionKey(reactionTarget)) ?? null
    : null;

  const handleReact = reactionTarget
    ? (next: CardReactionType) => {
        if (!user) {
          toast(
            "Sign in to personalize your feed",
            signInToVoteToastOptions(() => setLocation("/login")),
          );
          return;
        }
        reactionMutation.mutate({
          ...reactionTarget,
          // Tapping the active reaction toggles it off.
          reaction: currentReaction === next ? null : next,
          category,
        });
      }
    : undefined;

  const handleHide = reactionTarget
    ? () => {
        if (!user) {
          toast(
            "Sign in to hide cards",
            signInToVoteToastOptions(() => setLocation("/login")),
          );
          return;
        }
        hideCard.mutate({
          cardType: reactionTarget.surfaceType,
          cardId: reactionTarget.targetId,
        });
      }
    : undefined;

  if (menuDisabled) {
    return (
      <CategoryPill
        category={category}
        canonicalIdOverride={canonicalId}
        displayLabel={displayLabel}
        size={size}
        className={className}
        data-testid={testId}
      />
    );
  }

  const pillButton = (
    <button
      ref={hideHint.setChipElement}
      type="button"
      aria-label={`${label}, more options`}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`group relative inline-flex items-center gap-0.5 ${CATEGORY_CHIP_RADIUS} border w-fit whitespace-nowrap transition-all duration-200 hover:opacity-80 cursor-pointer bg-transparent ${sizeClass} ${style.bg} ${style.border} ${style.text} ${className}`}
      data-testid={testId}
    >
      <span className="truncate">{label}</span>
      <ChevronDown
        aria-hidden
        className={cn(
          "shrink-0 opacity-45 transition-all duration-200 group-hover:opacity-75",
          size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5",
          open && "rotate-180 opacity-75",
        )}
      />
      {hideHint.showHint && <HideHintChipGlow />}
      {hideHint.showHint && hideHint.chipElement && (
        <HideHintBubble anchor={hideHint.chipElement} onDone={hideHint.dismissHint} />
      )}
    </button>
  );

  const menuProps = {
    label,
    category,
    raceMarketId,
    leaderboardCategories,
    detailHref,
    detailLabel,
  };

  const detailNavHandler = detailOnNavigate
    ? () => {
        setOpen(false);
        detailOnNavigate();
      }
    : undefined;

  const finishBrowseSelection = () => {
    if (pendingBrowseFullScreenRef.current) return;
    if (browseTapRejectedRef.current) return;
    if (!hasCategoryPillBrowseIntent()) {
      markCategoryPillPassiveDismiss();
      setOpen(false);
      return;
    }
    // Commit before closing. The overlay's pointerup/click is a passive
    // dismiss and must not clear this token before snap view consumes it.
    // Flush here as well as from onOpenChange: WKWebView drops the click
    // vaul's Close uses to emit onOpenChange after setPointerCapture.
    commitCategoryPillBrowse();
    pendingBrowseFullScreenRef.current = true;
    setOpen(false);
    // Popover (desktop web) has no drawer onOpenChange and does not open the
    // snap overlay. Call sites only pass onBrowseFullScreen when isMobile,
    // which is the drawer branch below.
    if (isMobile) flushPendingBrowseFullScreenRef.current();
  };

  const rememberBrowseOrigin = (x: number, y: number) => {
    browseOriginRef.current = { x, y };
    browseTapRejectedRef.current = false;
    beginCategoryPillBrowsePress();
  };

  const settleBrowseRelease = (x: number, y: number, source: "pointer" | "touch") => {
    if (pendingBrowseFullScreenRef.current) return;
    if (!isBrowseTapWithinSlop(browseOriginRef.current, { x, y })) {
      // A touch pointerup can miss the slop while touchend (same gesture,
      // original target) is still the reliable iOS signal. Only the touch
      // release cancels, so a pointerup miss cannot eat a valid touchend.
      browseTapRejectedRef.current = true;
      if (source === "touch") cancelCategoryPillBrowsePress();
      return;
    }
    browseTapRejectedRef.current = false;
    finishBrowseSelection();
  };

  const browseFullScreenHandler = onBrowseFullScreen ? finishBrowseSelection : undefined;

  const onBrowsePointerDown = onBrowseFullScreen
    ? (event: React.PointerEvent<HTMLButtonElement>) => {
        rememberBrowseOrigin(event.clientX, event.clientY);
      }
    : undefined;

  const onBrowseTouchStart = onBrowseFullScreen
    ? (event: React.TouchEvent<HTMLButtonElement>) => {
        const touch = event.touches[0];
        if (!touch) return;
        rememberBrowseOrigin(touch.clientX, touch.clientY);
      }
    : undefined;

  const onBrowsePointerUp = onBrowseFullScreen
    ? (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        settleBrowseRelease(event.clientX, event.clientY, "pointer");
      }
    : undefined;

  const onBrowseTouchEnd = onBrowseFullScreen
    ? (event: React.TouchEvent<HTMLButtonElement>) => {
        const touch = event.changedTouches[0];
        if (!touch) return;
        settleBrowseRelease(touch.clientX, touch.clientY, "touch");
      }
    : undefined;

  const onBrowsePointerCancel = onBrowseFullScreen
    ? () => {
        browseTapRejectedRef.current = true;
        cancelCategoryPillBrowsePress();
      }
    : undefined;

  const handlePassiveOverlayDismiss = useCallback((event: React.SyntheticEvent) => {
    markCategoryPillPassiveDismiss();
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  }, []);

  const handleMobileOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && pendingBrowseFullScreenRef.current) {
      setOpen(false);
      flushPendingBrowseFullScreenRef.current();
      return;
    }

    if (!nextOpen) {
      // Vaul overlay unmounts during close animation; the browser re-targets the
      // pointer release to whatever element is underneath. Suppress passive closes
      // at the Snap opener too, because mobile browsers can retarget after unmount.
      markCategoryPillPassiveDismiss();
    }

    setOpen(nextOpen);
  }, []);

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={handleMobileOpenChange}
      >
        <DrawerTrigger asChild>{pillButton}</DrawerTrigger>
        <DrawerContent
          overlayProps={{
            onPointerDown: handlePassiveOverlayDismiss,
            onPointerUp: handlePassiveOverlayDismiss,
            onTouchEnd: handlePassiveOverlayDismiss,
            onMouseUp: handlePassiveOverlayDismiss,
            onClick: handlePassiveOverlayDismiss,
          }}
        >
          <div className="px-2 pb-4">
            <DrawerTitle className="sr-only">{label} actions</DrawerTitle>
            <MenuItems
              {...menuProps}
              share={share}
              sharerUserId={user?.id}
              reaction={currentReaction}
              onReact={handleReact}
              onHide={handleHide}
              onDetailNavigate={detailNavHandler}
              onBrowseIntentStart={(event) => {
                if ("touches" in event) onBrowseTouchStart?.(event);
                else onBrowsePointerDown?.(event);
              }}
              onBrowsePointerUp={onBrowsePointerUp}
              onBrowseTouchEnd={onBrowseTouchEnd}
              onBrowsePointerCancel={onBrowsePointerCancel}
              onBrowseFullScreen={browseFullScreenHandler}
              onFilter={() => {
                onFilter();
                setOpen(false);
              }}
              CloseWrapper={DrawerClose}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{pillButton}</PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1 bg-background">
        <MenuItems
          {...menuProps}
          share={share}
          sharerUserId={user?.id}
          reaction={currentReaction}
          onReact={handleReact}
          onHide={handleHide}
          onDetailNavigate={detailNavHandler}
          onBrowseIntentStart={(event) => {
            if ("touches" in event) onBrowseTouchStart?.(event);
            else onBrowsePointerDown?.(event);
          }}
          onBrowsePointerUp={onBrowsePointerUp}
          onBrowseTouchEnd={onBrowseTouchEnd}
          onBrowsePointerCancel={onBrowsePointerCancel}
          onBrowseFullScreen={browseFullScreenHandler}
          onFilter={() => {
            onFilter();
            setOpen(false);
          }}
          CloseWrapper={PopoverClose}
        />
      </PopoverContent>
    </Popover>
  );
}
