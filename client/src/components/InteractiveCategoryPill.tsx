import { useCallback, useRef, useState } from "react";
import { Link } from "wouter";
import { Filter, Trophy, Users, ExternalLink, Maximize2, ChevronDown } from "lucide-react";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { getCategoryStyle, CategoryPill } from "@/components/CategoryPill";
import { CATEGORY_CHIP_RADIUS, POLL_CARD_PILL_SIZE_CLASSES } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
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

const SIZE_CLASSES = {
  default: "px-2 py-0.5 text-[10px]",
  sm: "px-1 py-0.5 text-[9px] leading-none font-medium",
  pollCard: POLL_CARD_PILL_SIZE_CLASSES,
} as const;

const BROWSE_INTENT_TOKEN_MS = 1000;
const PASSIVE_DISMISS_SUPPRESSION_MS = 300;
let browseIntentExpiresAt = 0;
let browseIntentTimeout: number | null = null;
let passiveDismissSuppressedUntil = 0;
let passiveDismissTimeout: number | null = null;

function clearCategoryPillBrowseIntent() {
  browseIntentExpiresAt = 0;
  if (browseIntentTimeout !== null) {
    window.clearTimeout(browseIntentTimeout);
    browseIntentTimeout = null;
  }
}

function hasCategoryPillBrowseIntent(): boolean {
  if (Date.now() <= browseIntentExpiresAt) return true;
  clearCategoryPillBrowseIntent();
  return false;
}

function markCategoryPillBrowseIntent() {
  browseIntentExpiresAt = Date.now() + BROWSE_INTENT_TOKEN_MS;
  if (browseIntentTimeout !== null) {
    window.clearTimeout(browseIntentTimeout);
  }
  browseIntentTimeout = window.setTimeout(clearCategoryPillBrowseIntent, BROWSE_INTENT_TOKEN_MS);
}

export function consumeCategoryPillBrowseIntent(): boolean {
  const hasIntent = hasCategoryPillBrowseIntent();
  clearCategoryPillBrowseIntent();
  return hasIntent;
}

export function isCategoryPillDrawerDismissSuppressed(): boolean {
  return Date.now() < passiveDismissSuppressedUntil;
}

function markCategoryPillPassiveDismiss() {
  clearCategoryPillBrowseIntent();
  passiveDismissSuppressedUntil = Date.now() + PASSIVE_DISMISS_SUPPRESSION_MS;
  if (passiveDismissTimeout !== null) {
    window.clearTimeout(passiveDismissTimeout);
  }
  passiveDismissTimeout = window.setTimeout(() => {
    passiveDismissSuppressedUntil = 0;
    passiveDismissTimeout = null;
  }, PASSIVE_DISMISS_SUPPRESSION_MS);
}

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
  onBrowseIntentStart?: () => void;
  CloseWrapper: React.ComponentType<{ children: React.ReactNode; asChild?: boolean }>;
}) {
  const showLeaderboard = !leaderboardCategories || leaderboardCategories.has(normalizeMarketCategory(category));

  return (
    <div className="flex flex-col gap-1 py-1">
      <CloseWrapper asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors"
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
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
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
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors text-foreground"
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
              className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
            >
              <ExternalLink className="h-4 w-4 opacity-60 shrink-0" />
              {detailLabel || "View Details"}
            </Link>
          </CloseWrapper>
        )
      )}

      {onBrowseFullScreen ? (
        <CloseWrapper asChild>
          <button
            type="button"
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors text-foreground"
            onPointerDown={onBrowseIntentStart}
            onTouchStart={onBrowseIntentStart}
            onClick={onBrowseFullScreen}
          >
            <Maximize2 className="h-4 w-4 opacity-60 shrink-0" />
            Browse {label} Full Screen
          </button>
        </CloseWrapper>
      ) : showLeaderboard ? (
        <CloseWrapper asChild>
          <Link
            href={`/?category=${encodeURIComponent(label)}#leaderboard`}
            className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm rounded-md hover:bg-muted/60 transition-colors no-underline text-foreground"
          >
            <Users className="h-4 w-4 opacity-60 shrink-0" />
            View {label} on Leaderboard
          </Link>
        </CloseWrapper>
      ) : null}
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
  size = "default",
  className = "",
  "data-testid": testId,
}: InteractiveCategoryPillProps) {
  const [open, setOpen] = useState(false);
  const pendingBrowseFullScreenRef = useRef(false);
  const isMobile = useIsMobile();
  const style = getCategoryStyle(category);
  const sizeClass = SIZE_CLASSES[size];
  const label = getMarketCategoryLabel(category);

  if (menuDisabled) {
    return (
      <CategoryPill
        category={category}
        size={size}
        className={className}
        data-testid={testId}
      />
    );
  }

  const pillButton = (
    <button
      type="button"
      aria-label={`${label}, more options`}
      aria-haspopup="menu"
      aria-expanded={open}
      className={`group inline-flex items-center gap-0.5 ${CATEGORY_CHIP_RADIUS} border w-fit whitespace-nowrap transition-all duration-200 hover:opacity-80 cursor-pointer bg-transparent ${sizeClass} ${style.bg} ${style.border} ${style.text} ${className}`}
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

  const browseFullScreenHandler = onBrowseFullScreen
    ? () => {
        if (!hasCategoryPillBrowseIntent()) {
          markCategoryPillPassiveDismiss();
          setOpen(false);
          return;
        }
        pendingBrowseFullScreenRef.current = true;
        setOpen(false);
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pendingBrowseFullScreenRef.current = false;
          onBrowseFullScreen?.();
        });
      });
      return;
    }

    if (!nextOpen) {
      // Vaul overlay unmounts during close animation; the browser re-targets the
      // pointer release to whatever element is underneath. Suppress passive closes
      // at the Snap opener too, because mobile browsers can retarget after unmount.
      markCategoryPillPassiveDismiss();
    }

    setOpen(nextOpen);
  }, [onBrowseFullScreen]);

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
              onDetailNavigate={detailNavHandler}
              onBrowseIntentStart={markCategoryPillBrowseIntent}
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
      <PopoverContent align="end" className="w-56 p-1">
        <MenuItems
          {...menuProps}
          onDetailNavigate={detailNavHandler}
          onBrowseIntentStart={markCategoryPillBrowseIntent}
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
