import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, createContext, type MutableRefObject, type ReactNode, type UIEvent, type CSSProperties } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence, useMotionValue, useTransform, animate as motionAnimate } from "framer-motion";
import { ArrowLeft, ArrowUp, Inbox, Plus, X } from "lucide-react";
import { getCategoryStyle } from "@/components/CategoryPill";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { sharePage } from "@/lib/share";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  communityInsightsQueryKey,
  fetchCommunityInsightComments,
} from "@/lib/communityInsightsQuery";
import {
  buildVoteListState,
  navigateToPersonFromVoteHub,
  navigateWithVoteList,
  type VoteListNavType,
} from "@/lib/voteListNavigation";
import { CategoryTabStrip } from "./CategoryTabStrip";
import { SnapPageVisibility } from "./SnapPageVisibility";
import { CardComments, type CommentEntityType } from "@/components/comments/CardComments";
import { CommunityInsights } from "@/components/CommunityInsights";

export type SnapSectionType =
  | "matchups" | "sentiment" | "opinion"
  | "value" | "induction" | "curate"
  | "world-markets" | "updown";

export type SnapCommentMode = "card" | "person" | "none";

export interface SnapItem {
  id: string;
  slug: string;
  category: string;
  /** Optional additional categories (any format) used so the item also appears
   * under those category tabs. Normalized internally. */
  secondaryCategories?: string[] | null;
  title: string;
  personId?: string;
  personName?: string;
}

/** Incremented on horizontal category commit — descendants auto-dismiss overlays. */
export const SnapDismissContext = createContext(0);

export interface SnapRenderContext {
  /** Eager-load card images when true (visible / buffered snap page). */
  priority: boolean;
  index: number;
}

interface VoteSnapScrollViewProps {
  open: boolean;
  onClose: () => void;
  sectionType: SnapSectionType;
  items: SnapItem[];
  initialItemId?: string;
  renderCard: (item: SnapItem, ctx: SnapRenderContext) => ReactNode;
  onSuggest?: () => void;
  commentMode?: SnapCommentMode;
  /** Vote hub section filter when opening detail (defaults to "All"). */
  voteHubActiveSection?: string;
  /** When true, category tab starts on All (e.g. section-header expand). */
  initialCategoryAll?: boolean;
  /** Prefer parent handler so Vote can flatten snap history before /person. */
  onNavigateToPerson?: (personId: string) => void;
  /**
   * "minimal" — Quick Vote overlay chrome: glass shell instead of opaque
   * background, X close (no back arrow), no CategoryTabStrip (single "All"
   * column, no horizontal axis), no end card, elevated card wrapper.
   */
  variant?: "full" | "minimal";
  /** Rendered in the minimal header, left of the X close (e.g. vote budget). */
  headerSlot?: ReactNode;
  /** Imperative controls (Quick Vote auto-advance). */
  apiRef?: MutableRefObject<SnapViewApi | null>;
  /** Fires when the visible card index in the active column changes. */
  onVisibleIndexChange?: (index: number, item: SnapItem | null) => void;
}

export interface SnapViewApi {
  /** Smooth-scroll the active column down one snap page (no-op at the end). */
  advanceToNext: () => void;
}

const SECTION_COMMENT_TYPE: Partial<Record<SnapSectionType, CommentEntityType>> = {
  matchups: "matchup",
  sentiment: "poll",
  opinion: "opinion-poll",
  "world-markets": "open-market",
};

const SECTION_DETAIL_PREFIX: Partial<Record<SnapSectionType, string>> = {
  matchups: "/vote/matchups/",
  sentiment: "/polls/",
  opinion: "/vote/opinion-polls/",
  "world-markets": "/markets/",
  updown: "/predict/updown/",
};

const SECTION_LABEL: Record<SnapSectionType, string> = {
  matchups: "matchups",
  sentiment: "sentiment polls",
  opinion: "opinion polls",
  value: "value ratings",
  induction: "induction candidates",
  curate: "curate profiles",
  "world-markets": "world market predictions",
  updown: "weekly predictions",
};

const SNAP_TO_VOTE_LIST_TYPE: Partial<Record<SnapSectionType, VoteListNavType>> = {
  matchups: "matchup",
  sentiment: "sentiment",
  opinion: "opinion",
};

const SNAP_TO_VOTE_HUB_ANCHOR: Partial<Record<SnapSectionType, string>> = {
  value: "vote-value",
  induction: "vote-induction",
  curate: "vote-curate",
};

const SECTION_SUGGEST_LABEL: Record<SnapSectionType, string> = {
  matchups: "Matchup",
  sentiment: "Sentiment Poll",
  opinion: "Opinion Poll",
  value: "Profile Image",
  induction: "Candidate",
  curate: "Profile Image",
  "world-markets": "Market Prediction",
  updown: "Market Prediction",
};

const DRAG_THRESHOLD = 40;
const COMMENT_TAP_THRESHOLD = 12;
const COMMENT_SWIPE_TOP_THRESHOLD = 8;
const COMMENT_SWIPE_VELOCITY_THRESHOLD = 0.5;

const H_PAN_LOCK_THRESHOLD = 6;
const H_VERTICAL_BIAS = 0.7;
const H_COMMIT_RATIO = 0.3;
const H_COMMIT_VELOCITY = 500;
const H_BOUNCE_RESISTANCE = 3;
const H_COMMIT_TWEEN_DURATION = 0.24;
const VERTICAL_BUFFER = 1;

const SNAP_PAGE_HEIGHT = "calc(100dvh - 52px)";
const SNAP_PAGE_PADDING = "env(safe-area-inset-bottom, 16px)";

const COMMENT_PARENT_TYPE: Record<CommentEntityType, string> = {
  matchup: "matchup",
  poll: "trending_poll",
  "opinion-poll": "opinion_poll",
  "open-market": "open_market",
};

function snapPageStyle(isMinimal = false): CSSProperties {
  return {
    // Minimal variant: size pages off the scroll container itself (100% of
    // its content box) rather than 100dvh math. On iOS Safari, dvh and the
    // fixed-container layout height drift as the toolbar collapses, which
    // desyncs page height from clientHeight — breaking the visible-index
    // rounding, the ±1 render window, and snap targets (cards landing
    // half-off / at the bottom).
    height: isMinimal ? "100%" : SNAP_PAGE_HEIGHT,
    scrollSnapAlign: "start",
    paddingBottom: SNAP_PAGE_PADDING,
  };
}

function scheduleIdleTask(task: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task());
  } else {
    window.setTimeout(task, 1);
  }
}

function SnapEndCard({
  category,
  sectionType,
  categories,
  onSelectCategory,
  onSuggest,
  onBackToTop,
  onClose,
}: {
  category: string;
  sectionType: SnapSectionType;
  categories: string[];
  onSelectCategory: (cat: string) => void;
  onSuggest?: () => void;
  onBackToTop: () => void;
  onClose: () => void;
}) {
  const otherCategories = categories.filter((c) => c !== category && c !== "All");
  const displayCategory = category === "All" ? "this section" : category;
  const sectionLabel = SECTION_LABEL[sectionType];
  const suggestLabel = SECTION_SUGGEST_LABEL[sectionType];

  return (
    <div
      className="snap-start flex flex-col items-center justify-center px-6 text-center"
      style={{
        height: SNAP_PAGE_HEIGHT,
        scrollSnapAlign: "start",
        paddingBottom: SNAP_PAGE_PADDING,
        background: "linear-gradient(to bottom, hsl(var(--background)), hsl(var(--card) / 0.6))",
      }}
    >
      <div className="flex flex-col items-center gap-6 max-w-sm w-full">
        {/* Icon */}
        <div className="rounded-full bg-muted/50 p-4">
          <Inbox className="h-10 w-10 text-muted-foreground/60" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            That's all for {displayCategory}
          </h2>
          <p className="text-sm text-muted-foreground">
            You've seen every {sectionLabel} in this category
          </p>
        </div>

        {/* Suggest button */}
        {onSuggest && (
          <button
            onClick={onSuggest}
            className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
            Suggest a {suggestLabel}
          </button>
        )}

        {/* Category navigation */}
        {otherCategories.length > 0 && (
          <div className="w-full space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border/50" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">
                Explore other categories
              </span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {otherCategories.map((cat) => {
                const style = getCategoryStyle(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => onSelectCategory(cat)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-medium border transition-transform active:scale-95 ${style.bg} ${style.border} ${style.text}`}
                  >
                    {getMarketCategoryLabel(cat)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Utility buttons */}
        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={onBackToTop}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 active:scale-[0.97]"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            Back to top
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 active:scale-[0.97]"
          >
            <X className="h-3.5 w-3.5" />
            Close snap view
          </button>
        </div>
      </div>
    </div>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return Boolean(
    target.closest(
      'button, a, input, textarea, select, summary, [role="button"], [data-interactive="true"], [contenteditable="true"]',
    ),
  );
}

export function VoteSnapScrollView({
  open,
  onClose,
  sectionType,
  items,
  initialItemId,
  renderCard,
  onSuggest,
  commentMode = "card",
  voteHubActiveSection = "All",
  initialCategoryAll = false,
  onNavigateToPerson,
  variant = "full",
  headerSlot,
  apiRef,
  onVisibleIndexChange,
}: VoteSnapScrollViewProps) {
  const isMinimal = variant === "minimal";
  const [, setLocation] = useLocation();
  const commentScrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  /** Window-sash drag session on the expand/collapse handle. Card styles are
   * mutated directly during touchmove so the card follows the finger without
   * re-rendering; on release the existing 200ms class transition settles it. */
  const sashDragRef = useRef<{
    el: HTMLElement | null;
    startY: number;
    fullHeight: number;
    startExpanded: boolean;
    moved: boolean;
  } | null>(null);
  const commentTapStartRef = useRef<{ itemId: string; x: number; y: number } | null>(null);
  const commentSwipeStartRef = useRef<{ itemId: string; x: number; y: number; time: number } | null>(null);
  const commentSwipeConsumedRef = useRef(false);
  const commentTapMovedRef = useRef(false);

  // ── Horizontal pan state ──────────────────────────────────────────────
  const dragX = useMotionValue(0);
  const hPanContainerRef = useRef<HTMLDivElement>(null);
  const hPanRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    locked: "h" | "v" | null;
  } | null>(null);
  const hSwipeOccurredRef = useRef(false);
  const isAnimatingRef = useRef(false);
  const positionMemoryRef = useRef<Map<string, number>>(new Map());
  const columnScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const columnScrollRootRefs = useRef<Record<string, { current: HTMLDivElement | null }>>({});
  const [columnVisibleIndices, setColumnVisibleIndices] = useState<Record<string, number>>({});
  /** Minimal variant: the live column DOM node, tracked in STATE (not the
   * columnScrollRefs map — the open-init effect wipes that map after the
   * settle-guard effect has already read it, leaving the guard detached for
   * the whole session). State re-fires the guard effect whenever the real
   * node mounts/remounts. */
  const [minimalColumnEl, setMinimalColumnEl] = useState<HTMLDivElement | null>(null);
  const [dismissCounter, setDismissCounter] = useState(0);
  /** True after open-init runs; prevents vote refetch from resetting scroll/category. */
  const openInitializedRef = useRef(false);

  // Canonical category ids (same pipeline as buildSectionCategoryOptions / filters)
  // so alias strings like "Food & Drink" vs "food-drink" collapse to one snap tab.
  const normalizedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        category: normalizeMarketCategory(item.category),
        secondaryCategories: Array.isArray(item.secondaryCategories)
          ? item.secondaryCategories.map((s) => normalizeMarketCategory(s))
          : [],
      })),
    [items],
  );

  // ── Categories ────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    // Minimal variant: single curated column, no horizontal category axis.
    if (isMinimal) return ["All"];
    const cats = new Set<string>();
    normalizedItems.forEach((item) => {
      cats.add(item.category);
      item.secondaryCategories.forEach((s) => cats.add(s));
    });
    const sorted = Array.from(cats).sort((a, b) =>
      getMarketCategoryLabel(a).localeCompare(getMarketCategoryLabel(b)),
    );
    return ["All", ...sorted];
  }, [normalizedItems, isMinimal]);

  const initialCategoryIdx = useMemo(() => {
    if (initialCategoryAll) return 0;
    if (!initialItemId) return 0;
    const item = normalizedItems.find((i) => i.id === initialItemId);
    if (!item) return 0;
    const idx = categories.indexOf(item.category);
    return idx >= 0 ? idx : 0;
  }, [initialCategoryAll, initialItemId, normalizedItems, categories]);

  const [activeCategoryIdx, setActiveCategoryIdx] = useState(initialCategoryIdx);
  const [visualCategoryIdx, setVisualCategoryIdx] = useState(initialCategoryIdx);
  const activeCategory = categories[activeCategoryIdx] || "All";
  const visualCategory = categories[visualCategoryIdx] || activeCategory;

  // Stable refs so non-passive listeners read current values without re-binding
  const activeCategoryIdxRef = useRef(activeCategoryIdx);
  activeCategoryIdxRef.current = activeCategoryIdx;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  const categoryItems = useMemo(() => {
    const map = new Map<string, SnapItem[]>();
    map.set("All", normalizedItems);
    for (const cat of categories) {
      if (cat === "All") continue;
      map.set(
        cat,
        normalizedItems.filter(
          (i) => i.category === cat || i.secondaryCategories.includes(cat),
        ),
      );
    }
    return map;
  }, [normalizedItems, categories]);

  useEffect(() => {
    if (!open) {
      openInitializedRef.current = false;
      return;
    }
    if (openInitializedRef.current) return;
    openInitializedRef.current = true;

    setActiveCategoryIdx(initialCategoryIdx);
    setVisualCategoryIdx(initialCategoryIdx);
    setExpandedItemId(null);
    dragX.set(0);
    positionMemoryRef.current.clear();
    columnScrollRefs.current = {};
    columnScrollRootRefs.current = {};
    isAnimatingRef.current = false;
    hPanRef.current = null;

    const cat = initialCategoryAll ? "All" : (categories[initialCategoryIdx] || "All");
    const catItems = categoryItems.get(cat) || [];
    const idx = initialItemId ? catItems.findIndex((i) => i.id === initialItemId) : 0;
    setColumnVisibleIndices(idx >= 0 ? { [cat]: idx } : {});
  }, [open, initialCategoryIdx, dragX, initialCategoryAll, initialItemId, categories, categoryItems]);

  // Clamp scroll index when the active column shrinks (e.g. hide-mine) while snap stays open.
  useEffect(() => {
    if (!open || !openInitializedRef.current) return;

    const cat = categories[activeCategoryIdx] || "All";
    const colItems = categoryItems.get(cat) || [];
    if (colItems.length === 0) return;

    const currentIdx = columnVisibleIndices[cat] ?? 0;
    const maxIdx = colItems.length - 1;
    if (currentIdx <= maxIdx) return;

    setColumnVisibleIndices((prev) => ({ ...prev, [cat]: maxIdx }));
    const el = columnScrollRefs.current[cat];
    if (el) {
      el.scrollTo({ top: maxIdx * el.clientHeight, behavior: "auto" });
    }
  }, [open, activeCategoryIdx, categories, categoryItems, columnVisibleIndices]);

  // Windowed: [prev | null, current, next | null]
  const windowedCats = useMemo(() => {
    const prev = activeCategoryIdx > 0 ? categories[activeCategoryIdx - 1] : null;
    const current = categories[activeCategoryIdx];
    const next = activeCategoryIdx < categories.length - 1 ? categories[activeCategoryIdx + 1] : null;
    return [prev, current, next] as const;
  }, [activeCategoryIdx, categories]);

  // ── Position memory ───────────────────────────────────────────────────
  const captureScrollPosition = useCallback((cat: string) => {
    const el = columnScrollRefs.current[cat];
    if (!el) return;
    const h = el.clientHeight;
    if (h === 0) return;
    positionMemoryRef.current.set(cat, Math.round(el.scrollTop / h));
  }, []);

  const restoreScrollPosition = useCallback((cat: string, el: HTMLDivElement | null) => {
    if (!el) return;
    const idx = positionMemoryRef.current.get(cat);
    if (idx != null && idx > 0) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: idx * el.clientHeight, behavior: "auto" });
        setColumnVisibleIndices((prev) => ({ ...prev, [cat]: idx }));
      });
    }
  }, []);

  // ── Image warming (preload upcoming cards) ────────────────────────────
  const warmImagesInColumn = useCallback((el: HTMLElement) => {
    const h = el.clientHeight;
    const cr = el.getBoundingClientRect();
    el.querySelectorAll("img").forEach((node) => {
      const img = node as HTMLImageElement;
      if (img.loading === "eager") return;
      const r = img.getBoundingClientRect();
      const top = r.top - cr.top;
      if (top < h * 2 && r.bottom - cr.top > -h) {
        img.loading = "eager";
      }
    });
  }, []);

  const updateColumnVisibleIndex = useCallback((cat: string, el: HTMLDivElement) => {
    const h = el.clientHeight;
    if (h === 0) return;
    const idx = Math.round(el.scrollTop / h);
    setColumnVisibleIndices((prev) => (prev[cat] === idx ? prev : { ...prev, [cat]: idx }));
  }, []);

  const warmRafRef = useRef<number | null>(null);
  const handleColumnScroll = useCallback(
    (cat: string) => (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      updateColumnVisibleIndex(cat, el);
      if (warmRafRef.current != null) return;
      warmRafRef.current = requestAnimationFrame(() => {
        warmRafRef.current = null;
        warmImagesInColumn(el);
      });
    },
    [updateColumnVisibleIndex, warmImagesInColumn],
  );

  // ── getVisibleItem (current column) ───────────────────────────────────
  const getVisibleItem = useCallback((): SnapItem | null => {
    const catItems = categoryItems.get(activeCategory) || [];
    const container = columnScrollRefs.current[activeCategory];
    if (!container || catItems.length === 0) return catItems[0] || null;
    const scrollTop = container.scrollTop;
    const frameHeight = container.clientHeight;
    const idx = Math.round(scrollTop / frameHeight);
    return catItems[Math.min(idx, catItems.length - 1)] || null;
  }, [categoryItems, activeCategory]);

  // ── Imperative API (Quick Vote auto-advance) ──────────────────────────
  // rAF-tween with scroll-snap disabled for the duration: iOS Safari's
  // scrollTo({behavior:"smooth"}) inside a snap-mandatory container is a
  // known WebKit conflict that can strand the scroll between snap points.
  const programmaticScrollActiveRef = useRef(false);
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      advanceToNext: () => {
        const cat = categoriesRef.current[activeCategoryIdxRef.current] || "All";
        const el = columnScrollRefs.current[cat];
        if (!el || programmaticScrollActiveRef.current) return;
        const h = el.clientHeight;
        if (h === 0) return;
        const idx = Math.round(el.scrollTop / h);
        const target = (idx + 1) * h;
        if (target >= el.scrollHeight) return;

        const startTop = el.scrollTop;
        const dist = target - startTop;
        const duration = 350;
        const startTs = performance.now();
        programmaticScrollActiveRef.current = true;
        el.style.scrollSnapType = "none";

        let rafId = 0;
        const finish = (jumpToTarget: boolean) => {
          cancelAnimationFrame(rafId);
          el.removeEventListener("touchstart", onTouch);
          if (jumpToTarget) el.scrollTop = target;
          el.style.scrollSnapType = "y mandatory";
          programmaticScrollActiveRef.current = false;
        };
        // User takes over mid-tween: stop where we are, snap re-engages on release.
        const onTouch = () => finish(false);
        el.addEventListener("touchstart", onTouch, { passive: true });

        const step = (now: number) => {
          const t = Math.min((now - startTs) / duration, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          el.scrollTop = startTop + dist * eased;
          if (t < 1) {
            rafId = requestAnimationFrame(step);
          } else {
            finish(true);
          }
        };
        rafId = requestAnimationFrame(step);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  // ── Settle guard (minimal): self-heal any stuck-halfway scroll state ───
  // If the column rests misaligned (interrupted momentum, dvh shift, WebKit
  // snap failure), snap instantly to the nearest page once scrolling idles.
  // Keyed on the STATE-tracked column node so it attaches whenever the node
  // actually mounts (see minimalColumnEl declaration).
  useEffect(() => {
    if (!isMinimal || !open || !minimalColumnEl) return;
    const el = minimalColumnEl;

    let touchActive = false;
    let settleTimer: number | null = null;
    let lastScrollTs = 0;
    /** scrollTop sampled when the settle timer last fired; NaN = no sample. */
    let restSample = Number.NaN;
    const clearTimer = () => {
      if (settleTimer != null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
      restSample = Number.NaN;
    };
    const armTimer = () => {
      settleTimer = window.setTimeout(settle, 160);
    };
    const settle = () => {
      settleTimer = null;
      if (touchActive || programmaticScrollActiveRef.current) {
        restSample = Number.NaN;
        return;
      }
      // Rest detection: iOS pauses scroll events mid-snap-animation, so
      // event-quiet !== at-rest. Correcting during the momentum→snap handoff
      // yanks the scroller back to the current card and kills the gesture.
      // Only act once two consecutive samples (~160ms apart) match — a
      // native snap animation never RESTS misaligned, so a stable-but-off
      // position is genuinely stranded.
      const top = el.scrollTop;
      if (Number.isNaN(restSample) || restSample !== top) {
        restSample = top;
        armTimer();
        return;
      }
      restSample = Number.NaN;
      const h = el.clientHeight;
      if (h === 0) return;
      const maxTop = Math.max(0, el.scrollHeight - h);
      const nearest = Math.max(0, Math.min(Math.round(top / h) * h, maxTop));
      if (Math.abs(top - nearest) > 4) {
        el.scrollTop = nearest;
      }
    };
    const onScroll = () => {
      lastScrollTs = performance.now();
      clearTimer();
      armTimer();
    };
    const onTouchStart = () => {
      touchActive = true;
      clearTimer();
    };
    const onTouchEnd = () => {
      touchActive = false;
      clearTimer();
      armTimer();
    };

    // Height re-anchor: when the container resizes (iOS toolbar collapse,
    // keyboard dismissal settling after a login return), every snap target
    // moves. Keep the same card index anchored: compute the index against
    // the PREVIOUS height, then re-derive scrollTop from the new height.
    // Only applied while the scroller is idle — if it's mid-animation when
    // the resize lands, skip and let the rest-based settle pass align it.
    let lastHeight = el.clientHeight;
    const resizeObserver = new ResizeObserver(() => {
      const h = el.clientHeight;
      if (h === 0 || h === lastHeight) return;
      const prevHeight = lastHeight;
      lastHeight = h;
      if (touchActive || programmaticScrollActiveRef.current) return;
      if (performance.now() - lastScrollTs < 150) return;
      const idx = prevHeight > 0 ? Math.round(el.scrollTop / prevHeight) : 0;
      const maxTop = Math.max(0, el.scrollHeight - h);
      el.scrollTop = Math.max(0, Math.min(idx * h, maxTop));
    });
    resizeObserver.observe(el);

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      clearTimer();
      resizeObserver.disconnect();
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [isMinimal, open, minimalColumnEl]);

  // ── Visible-index change notification ─────────────────────────────────
  useEffect(() => {
    if (!onVisibleIndexChange) return;
    const catItems = categoryItems.get(activeCategory) || [];
    const idx = columnVisibleIndices[activeCategory] ?? 0;
    onVisibleIndexChange(
      idx,
      catItems[Math.min(idx, Math.max(catItems.length - 1, 0))] ?? null,
    );
  }, [onVisibleIndexChange, columnVisibleIndices, activeCategory, categoryItems]);

  // ── Initial scroll on open (once per open — not on items refetch) ─────
  useLayoutEffect(() => {
    if (!open || !initialItemId || openInitializedRef.current) return;

    const cat = initialCategoryAll ? "All" : (categories[initialCategoryIdx] || "All");
    const catItems = categoryItems.get(cat) || [];
    const idx = catItems.findIndex((i) => i.id === initialItemId);

    const scrollToInitial = () => {
      const el = columnScrollRefs.current[cat];
      if (!el) return false;
      if (idx > 0) {
        el.scrollTo({ top: idx * el.clientHeight, behavior: "auto" });
      } else {
        el.scrollTop = 0;
      }
      if (idx >= 0) {
        setColumnVisibleIndices((prev) => (prev[cat] === idx ? prev : { ...prev, [cat]: idx }));
      }
      warmImagesInColumn(el);
      return true;
    };

    // Verification pass: the jump above measures clientHeight while the
    // viewport may still be settling (iOS address bar / keyboard right after
    // a login return). Re-anchor against the settled height on the next
    // frame and again shortly after — belt-and-braces for the window before
    // the settle guard's ResizeObserver takes over. Only corrects while the
    // scroller still rounds to the restored index, so it fixes height drift
    // on the same card without fighting a user who already swiped away.
    let verifyRaf = 0;
    let verifyTimer = 0;
    const verifyAnchor = () => {
      if (idx <= 0 || programmaticScrollActiveRef.current) return;
      const el = columnScrollRefs.current[cat];
      if (!el) return;
      const h = el.clientHeight;
      if (h === 0) return;
      if (Math.round(el.scrollTop / h) !== idx) return;
      const target = Math.min(idx * h, Math.max(0, el.scrollHeight - h));
      if (Math.abs(el.scrollTop - target) > 4) {
        el.scrollTo({ top: target, behavior: "auto" });
      }
    };

    if (!scrollToInitial()) {
      requestAnimationFrame(scrollToInitial);
    }
    verifyRaf = requestAnimationFrame(verifyAnchor);
    verifyTimer = window.setTimeout(verifyAnchor, 300);
    return () => {
      cancelAnimationFrame(verifyRaf);
      window.clearTimeout(verifyTimer);
    };
  }, [open, initialItemId, initialCategoryAll, initialCategoryIdx, categories, categoryItems, warmImagesInColumn]);

  // ── Comment swipe native listener ─────────────────────────────────────
  useEffect(() => {
    const el = commentScrollRef.current;
    if (!el) return;

    const handleNativeTouchMove = (e: TouchEvent) => {
      const swipeStart = commentSwipeStartRef.current;
      if (!swipeStart || e.touches.length === 0) return;
      if (el.scrollTop > COMMENT_SWIPE_TOP_THRESHOLD) return;

      const deltaY = e.touches[0].clientY - swipeStart.y;
      const deltaX = e.touches[0].clientX - swipeStart.x;
      const elapsed = Math.max(e.timeStamp - swipeStart.time, 1);
      const velocity = deltaY / elapsed;

      if (deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX) && (deltaY >= DRAG_THRESHOLD || velocity >= COMMENT_SWIPE_VELOCITY_THRESHOLD)) {
        commentSwipeConsumedRef.current = true;
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", handleNativeTouchMove);
  }, [expandedItemId, activeCategory]);

  // ── Horizontal pan: non-passive touchmove ─────────────────────────────
  useEffect(() => {
    const el = hPanContainerRef.current;
    if (!el) return;

    const handleTouchMove = (e: TouchEvent) => {
      const pan = hPanRef.current;
      if (!pan || e.touches.length === 0) return;

      const dx = e.touches[0].clientX - pan.startX;
      const dy = e.touches[0].clientY - pan.startY;

      if (pan.locked === null) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= H_PAN_LOCK_THRESHOLD) {
          pan.locked = Math.abs(dx) > Math.abs(dy) * H_VERTICAL_BIAS ? "h" : "v";
        }
      }

      if (pan.locked === "h") {
        e.preventDefault();

        const idx = activeCategoryIdxRef.current;
        const cats = categoriesRef.current;
        let adjustedDx = dx;
        if ((idx === 0 && dx > 0) || (idx === cats.length - 1 && dx < 0)) {
          adjustedDx = dx / H_BOUNCE_RESISTANCE;
        }
        dragX.set(adjustedDx);

        const vw = window.innerWidth;
        const newVisualIdx = idx - Math.round(adjustedDx / vw);
        const clamped = Math.max(0, Math.min(cats.length - 1, newVisualIdx));
        setVisualCategoryIdx(clamped);
      }
    };

    const suppressClick = (e: Event) => {
      if (hSwipeOccurredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        hSwipeOccurredRef.current = false;
      }
    };

    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("click", suppressClick, true);
    return () => {
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("click", suppressClick, true);
    };
  }, [dragX, open]);

  // ── Horizontal commit / spring-back ───────────────────────────────────
  const commitHorizontalSwipe = useCallback((direction: -1 | 1) => {
    const idx = activeCategoryIdxRef.current;
    const cats = categoriesRef.current;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= cats.length) return;

    captureScrollPosition(cats[idx]);
    setExpandedItemId(null);
    setDismissCounter((c) => c + 1);

    isAnimatingRef.current = true;
    const vw = window.innerWidth;
    const compensated = dragX.get() + direction * vw;

    setActiveCategoryIdx(newIdx);
    setVisualCategoryIdx(newIdx);
    dragX.set(compensated);

    motionAnimate(dragX, 0, {
      type: "tween",
      duration: H_COMMIT_TWEEN_DURATION,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (v) => {
        if (Math.abs(v) < 2) {
          isAnimatingRef.current = false;
        }
      },
      onComplete: () => {
        isAnimatingRef.current = false;
      },
    });
  }, [captureScrollPosition, dragX]);

  const springBack = useCallback(() => {
    motionAnimate(dragX, 0, {
      type: "spring",
      stiffness: 400,
      damping: 35,
    });
    setVisualCategoryIdx(activeCategoryIdxRef.current);
  }, [dragX]);

  // ── Horizontal pan: touchstart / touchend ─────────────────────────────
  const handleHPanTouchStart = useCallback((e: React.TouchEvent) => {
    if (isAnimatingRef.current) return;

    const idx = activeCategoryIdxRef.current;
    const cats = categoriesRef.current;
    for (const offset of [-1, 1] as const) {
      const adjCat = cats[idx + offset];
      if (!adjCat) continue;
      const el = columnScrollRefs.current[adjCat];
      if (el) warmImagesInColumn(el);
    }

    hPanRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: performance.now(),
      locked: null,
    };
  }, [warmImagesInColumn]);

  const handleHPanTouchEnd = useCallback((e: React.TouchEvent) => {
    const pan = hPanRef.current;
    hPanRef.current = null;
    if (!pan || pan.locked !== "h") return;

    hSwipeOccurredRef.current = true;
    requestAnimationFrame(() => { hSwipeOccurredRef.current = false; });

    const dx = e.changedTouches[0].clientX - pan.startX;
    const elapsed = Math.max(performance.now() - pan.startTime, 1);
    const velocity = (dx / elapsed) * 1000;
    const vw = window.innerWidth;
    const idx = activeCategoryIdxRef.current;
    const cats = categoriesRef.current;

    let direction: -1 | 1 | 0 = 0;
    if (Math.abs(dx) >= vw * H_COMMIT_RATIO || Math.abs(velocity) >= H_COMMIT_VELOCITY) {
      direction = dx > 0 ? -1 : 1;
    }

    // Minimal variant has no horizontal category axis — a committed swipe
    // in either direction dismisses the overlay instead.
    if (isMinimal) {
      // Reset the drag offset either way so the exit fade isn't skewed.
      springBack();
      if (direction !== 0) onClose();
      return;
    }

    const targetIdx = idx + (direction as number);
    if (direction !== 0 && targetIdx >= 0 && targetIdx < cats.length) {
      commitHorizontalSwipe(direction as -1 | 1);
    } else {
      springBack();
    }
  }, [commitHorizontalSwipe, springBack, isMinimal, onClose]);

  const handleHPanTouchCancel = useCallback(() => {
    hPanRef.current = null;
    springBack();
  }, [springBack]);

  // ── Category select (chip tap) with slide animation ───────────────────
  const handleCategorySelect = useCallback((cat: string) => {
    const cats = categoriesRef.current;
    const newIdx = cats.indexOf(cat);
    if (newIdx < 0 || newIdx === activeCategoryIdxRef.current) return;
    if (isAnimatingRef.current) return;

    const oldIdx = activeCategoryIdxRef.current;
    captureScrollPosition(cats[oldIdx]);
    setExpandedItemId(null);
    setDismissCounter((c) => c + 1);

    isAnimatingRef.current = true;
    const vw = window.innerWidth;
    const slideDir = newIdx > oldIdx ? 1 : -1;

    setActiveCategoryIdx(newIdx);
    setVisualCategoryIdx(newIdx);
    dragX.set(slideDir * vw);

    motionAnimate(dragX, 0, {
      type: "tween",
      duration: H_COMMIT_TWEEN_DURATION,
      ease: [0.32, 0.72, 0, 1],
      onUpdate: (v) => {
        if (Math.abs(v) < 2) {
          isAnimatingRef.current = false;
        }
      },
      onComplete: () => {
        isAnimatingRef.current = false;
      },
    });
  }, [captureScrollPosition, dragX]);

  // ── Existing handlers (unchanged) ─────────────────────────────────────
  const navigateToDetail = useCallback(() => {
    const item = getVisibleItem();
    if (!item) return;
    const detailPrefix = SECTION_DETAIL_PREFIX[sectionType];
    if (!detailPrefix || !item.slug) {
      if (item.personId) {
        if (onNavigateToPerson) {
          onNavigateToPerson(item.personId);
          return;
        }
        const anchorHashId = SNAP_TO_VOTE_HUB_ANCHOR[sectionType] ?? "vote-value";
        navigateToPersonFromVoteHub(setLocation, item.personId, {
          anchorHashId,
          activeSection: voteHubActiveSection,
        });
      }
      return;
    }
    const listType = SNAP_TO_VOTE_LIST_TYPE[sectionType];
    if (listType) {
      const listItems = categoryItems.get(activeCategory) || [];
      const slugs = listItems.map((i) => i.slug).filter(Boolean);
      if (slugs.length > 0) {
        const voteList = buildVoteListState({
          type: listType,
          slugs,
          currentSlug: item.slug,
          activeSection: voteHubActiveSection,
        });
        navigateWithVoteList(setLocation, voteList, `${detailPrefix}${encodeURIComponent(item.slug)}`);
        return;
      }
    }
    setLocation(`${detailPrefix}${encodeURIComponent(item.slug)}`);
  }, [activeCategory, categoryItems, getVisibleItem, onNavigateToPerson, sectionType, setLocation, voteHubActiveSection]);

  const { user } = useAuth();
  const handleShare = useCallback(() => {
    const item = getVisibleItem();
    if (item) sharePage(item.title, { sharerUserId: user?.id, surface: "vote_deck" });
  }, [getVisibleItem, user?.id]);

  const handleDragStart = useCallback((e: React.TouchEvent, isExpanded: boolean) => {
    // Handle wrapper ("flex justify-center") sits directly after the card wrapper.
    const cardEl = (e.currentTarget.parentElement?.previousElementSibling ?? null) as HTMLElement | null;
    sashDragRef.current = {
      el: cardEl,
      startY: e.touches[0].clientY,
      // scrollHeight reads the natural content height even at max-height 0.
      fullHeight: cardEl?.scrollHeight ?? 0,
      startExpanded: isExpanded,
      moved: false,
    };
  }, []);

  const handleDragMove = useCallback((e: React.TouchEvent) => {
    const drag = sashDragRef.current;
    if (!drag?.el || drag.fullHeight === 0) return;
    const deltaY = e.touches[0].clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) > 6) drag.moved = true;
    if (!drag.moved) return;
    const raw = drag.startExpanded ? deltaY : drag.fullHeight + deltaY;
    const height = Math.min(Math.max(raw, 0), drag.fullHeight);
    drag.el.style.transition = "none";
    drag.el.style.maxHeight = `${height}px`;
    drag.el.style.opacity = String(height / drag.fullHeight);
  }, []);

  const handleDragEnd = useCallback((e: React.TouchEvent, itemId: string) => {
    const drag = sashDragRef.current;
    if (!drag) return;
    const el = drag.el;
    if (!drag.moved) {
      // Tap: the click handler performs the toggle.
      if (el) {
        el.style.transition = "";
        el.style.maxHeight = "";
        el.style.opacity = "";
      }
      return;
    }
    const deltaY = e.changedTouches[0].clientY - drag.startY;
    const raw = drag.startExpanded ? deltaY : drag.fullHeight + deltaY;
    const height = Math.min(Math.max(raw, 0), drag.fullHeight);
    const cardOpenPastHalf = drag.fullHeight > 0 && height > drag.fullHeight / 2;
    setExpandedItemId(cardOpenPastHalf ? null : itemId);
    if (el) {
      // Re-arm the class transition, then release inline styles next frame so
      // the card eases from the drag position to its settled state.
      el.style.transition = "";
      requestAnimationFrame(() => {
        el.style.maxHeight = "";
        el.style.opacity = "";
      });
    }
  }, []);

  const handleHandleClick = useCallback((itemId: string, isExpanded: boolean) => {
    const dragMoved = sashDragRef.current?.moved ?? false;
    sashDragRef.current = null;
    if (dragMoved) return;
    setExpandedItemId(isExpanded ? null : itemId);
  }, []);

  const handleCommentTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, itemId: string, isExpanded: boolean) => {
    if (isInteractiveTarget(e.target)) {
      commentTapStartRef.current = null;
      commentSwipeStartRef.current = null;
      commentSwipeConsumedRef.current = false;
      commentTapMovedRef.current = false;
      return;
    }
    if (isExpanded) {
      commentTapStartRef.current = null;
      commentSwipeConsumedRef.current = false;
      commentTapMovedRef.current = false;
      commentSwipeStartRef.current = e.currentTarget.scrollTop <= COMMENT_SWIPE_TOP_THRESHOLD
        ? { itemId, x: e.touches[0].clientX, y: e.touches[0].clientY, time: e.timeStamp }
        : null;
      return;
    }
    commentTapStartRef.current = { itemId, x: e.touches[0].clientX, y: e.touches[0].clientY };
    commentTapMovedRef.current = false;
  }, []);

  const handleCommentTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (commentSwipeStartRef.current) return;
    if (!commentTapStartRef.current) return;
    const deltaX = e.touches[0].clientX - commentTapStartRef.current.x;
    const deltaY = e.touches[0].clientY - commentTapStartRef.current.y;
    if (Math.abs(deltaX) > COMMENT_TAP_THRESHOLD || Math.abs(deltaY) > COMMENT_TAP_THRESHOLD) {
      commentTapMovedRef.current = true;
    }
  }, []);

  const handleCommentTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>, itemId: string, isExpanded: boolean) => {
    const swipeStart = commentSwipeStartRef.current;
    const swipeConsumed = commentSwipeConsumedRef.current;
    commentSwipeStartRef.current = null;
    commentSwipeConsumedRef.current = false;
    if (swipeStart) {
      if (swipeStart.itemId !== itemId || !isExpanded || isInteractiveTarget(e.target)) return;
      const deltaY = e.changedTouches[0].clientY - swipeStart.y;
      const deltaX = e.changedTouches[0].clientX - swipeStart.x;
      const elapsed = Math.max(e.timeStamp - swipeStart.time, 1);
      const velocity = deltaY / elapsed;
      if (swipeConsumed || (deltaY > 0 && Math.abs(deltaY) >= Math.abs(deltaX) && (deltaY >= DRAG_THRESHOLD || velocity >= COMMENT_SWIPE_VELOCITY_THRESHOLD))) {
        e.preventDefault();
        e.stopPropagation();
        setExpandedItemId(null);
      }
      return;
    }
    const tapStart = commentTapStartRef.current;
    commentTapStartRef.current = null;
    if (!tapStart || tapStart.itemId !== itemId || isExpanded || commentTapMovedRef.current || isInteractiveTarget(e.target)) {
      commentTapMovedRef.current = false;
      return;
    }
    commentTapMovedRef.current = false;
    setExpandedItemId(itemId);
  }, []);

  const handleCommentTouchCancel = useCallback(() => {
    commentTapStartRef.current = null;
    commentSwipeStartRef.current = null;
    commentSwipeConsumedRef.current = false;
    commentTapMovedRef.current = false;
  }, []);

  // ── Container transform ───────────────────────────────────────────────
  // windowedCats is always [prev|null, current, next|null], so the
  // middle slot (index 1) is the committed category.
  const containerX = useTransform(dragX, (v) => -window.innerWidth + v);

  const commentEntityType = SECTION_COMMENT_TYPE[sectionType] ?? "matchup";
  const hasComments = commentMode !== "none";

  useEffect(
    () => () => {
      if (warmRafRef.current != null) cancelAnimationFrame(warmRafRef.current);
    },
    [],
  );

  // Prefetch comment data for the next few cards after open (idle time).
  useEffect(() => {
    if (!open || commentMode === "none") return;
    const cat = categories[activeCategoryIdx] || "All";
    const colItems = categoryItems.get(cat) || [];
    const visibleIdx = columnVisibleIndices[cat] ?? 0;

    scheduleIdleTask(() => {
      const prefetchItems = colItems.slice(visibleIdx, visibleIdx + 3);
      for (const item of prefetchItems) {
        if (commentMode === "person" && item.personId) {
          const personId = item.personId;
          void queryClient.prefetchQuery({
            queryKey: communityInsightsQueryKey(personId),
            queryFn: () => fetchCommunityInsightComments(personId),
          });
        } else if (item.slug) {
          const parentType = COMMENT_PARENT_TYPE[commentEntityType];
          void queryClient.prefetchQuery({
            queryKey: ["/api/comments", parentType, item.slug] as const,
            queryFn: async () => {
              const res = await apiRequest(
                "GET",
                `/api/comments?parentType=${parentType}&parentSlug=${encodeURIComponent(item.slug)}&limit=100`,
              );
              return res.json();
            },
          });
        }
      }
    });
  }, [open, activeCategoryIdx, categories, categoryItems, columnVisibleIndices, commentMode, commentEntityType]);

  const getColumnScrollRoot = useCallback((cat: string): { current: HTMLDivElement | null } => {
    if (!columnScrollRootRefs.current[cat]) {
      columnScrollRootRefs.current[cat] = { current: null };
    }
    return columnScrollRootRefs.current[cat];
  }, []);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={`fixed inset-0 z-[60] flex flex-col ${
            isMinimal ? "bg-black/40 backdrop-blur-md" : "bg-background"
          }`}
        >
          {/* Header */}
          {isMinimal ? (
            // Fixed 52px header; minimal snap pages size off the scroll
            // container (100%), so exact header height is not load-bearing.
            <div className="shrink-0 h-[52px] flex items-center safe-top px-1">
              <div className="flex-1 min-w-0 pl-3">{headerSlot}</div>
              <button
                onClick={onClose}
                className="p-3 text-white/80 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-interactive="true"
                aria-label="Close quick vote"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="shrink-0 flex items-center border-b border-border/30 bg-background/95 backdrop-blur-md safe-top">
              <button
                onClick={onClose}
                className="p-3 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-interactive="true"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex-1 overflow-hidden">
                <CategoryTabStrip
                  categories={categories}
                  activeCategory={visualCategory}
                  onSelect={handleCategorySelect}
                />
              </div>
            </div>
          )}

          {/* Windowed horizontal columns */}
          <SnapDismissContext.Provider value={dismissCounter}>
            <div className="flex-1 min-h-0 overflow-hidden" ref={hPanContainerRef}>
              <motion.div
                className="flex h-full will-change-transform"
                style={{ width: "300vw", x: containerX, touchAction: "pan-y" }}
                onTouchStart={handleHPanTouchStart}
                onTouchEnd={handleHPanTouchEnd}
                onTouchCancel={handleHPanTouchCancel}
              >
                {windowedCats.map((cat, slotIdx) => {
                  if (cat === null) {
                    return <div key={`empty-${slotIdx}`} className="shrink-0 h-full" style={{ width: "100vw" }} />;
                  }
                  const colItems = categoryItems.get(cat) || [];
                  return (
                    <div key={cat} className="shrink-0 h-full" style={{ width: "100vw" }}>
                      {colItems.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 px-8">
                          <Inbox className="h-10 w-10 opacity-40" />
                          <p className="text-sm text-center">
                            No {SECTION_LABEL[sectionType]} in{" "}
                            <span className="font-semibold">{cat}</span> yet
                          </p>
                        </div>
                      ) : (
                        <div
                          ref={(el) => {
                            columnScrollRefs.current[cat] = el;
                            getColumnScrollRoot(cat).current = el;
                            if (isMinimal) setMinimalColumnEl(el);
                            if (el) {
                              restoreScrollPosition(cat, el);
                              requestAnimationFrame(() => warmImagesInColumn(el));
                            }
                          }}
                          onScroll={handleColumnScroll(cat)}
                          className="h-full overflow-y-auto snap-y snap-mandatory"
                          style={{ scrollSnapType: "y mandatory" }}
                        >
                          {(() => {
                            const visibleIdx = columnVisibleIndices[cat] ?? 0;
                            const windowStart = Math.max(0, visibleIdx - VERTICAL_BUFFER);
                            const windowEnd = Math.min(colItems.length - 1, visibleIdx + VERTICAL_BUFFER);
                            const scrollRoot = getColumnScrollRoot(cat);

                            return colItems.map((item, index) => {
                              const inWindow = index >= windowStart && index <= windowEnd;
                              const isExpanded = expandedItemId === item.id;
                              const renderCtx: SnapRenderContext = { priority: inWindow, index };

                              if (!hasComments) {
                                return (
                                  <div
                                    key={item.id}
                                    className="snap-start flex flex-col items-center justify-center px-3 pt-3"
                                    style={snapPageStyle(isMinimal)}
                                  >
                                    {inWindow ? (
                                      <div
                                        className={`w-full max-w-lg mx-auto ${
                                          isMinimal
                                            ? "rounded-[12px] shadow-2xl shadow-black/60 ring-1 ring-white/10"
                                            : ""
                                        }`}
                                      >
                                        {renderCard(item, renderCtx)}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              }

                              return (
                                <div
                                  key={item.id}
                                  className="snap-start flex flex-col px-3 pt-3"
                                  style={snapPageStyle(isMinimal)}
                                >
                                  {inWindow ? (
                                    <SnapPageVisibility scrollRoot={scrollRoot}>
                                      {({ isNearVisible }) => (
                                        <>
                                          <div
                                            className={`w-full max-w-lg mx-auto shrink-0 transition-all duration-200 overflow-hidden ${
                                              isExpanded ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
                                            }`}
                                          >
                                            {renderCard(item, renderCtx)}
                                          </div>

                                          <div className="flex justify-center">
                                            <div
                                              className="flex flex-col items-center px-6 pb-2.5 cursor-grab active:cursor-grabbing touch-none select-none"
                                              onTouchStart={(e) => handleDragStart(e, isExpanded)}
                                              onTouchMove={handleDragMove}
                                              onTouchEnd={(e) => handleDragEnd(e, item.id)}
                                              onClick={() => handleHandleClick(item.id, isExpanded)}
                                              role="button"
                                              aria-label={isExpanded ? "Collapse" : "Expand"}
                                            >
                                              {/* U-bracket: side rails rise to meet the card's bottom border */}
                                              <div className="w-14 h-4 -mt-px border-l-2 border-r-2 border-b-2 border-muted-foreground/[0.42] rounded-b-lg flex flex-col items-center justify-center gap-[3px]">
                                                <div className="w-8 h-[2px] rounded-full bg-muted-foreground/[0.42]" />
                                                <div className="w-8 h-[2px] rounded-full bg-muted-foreground/[0.42]" />
                                              </div>
                                            </div>
                                          </div>

                                          <div
                                            ref={isExpanded ? commentScrollRef : undefined}
                                            className="flex-1 min-h-0 overflow-y-auto max-w-lg mx-auto w-full"
                                            style={isExpanded ? { overscrollBehavior: "contain" } : undefined}
                                            onTouchStart={(e) => handleCommentTouchStart(e, item.id, isExpanded)}
                                            onTouchMove={handleCommentTouchMove}
                                            onTouchEnd={(e) => handleCommentTouchEnd(e, item.id, isExpanded)}
                                            onTouchCancel={handleCommentTouchCancel}
                                          >
                                            {commentMode === "person" && item.personId ? (
                                              <CommunityInsights
                                                personId={item.personId}
                                                personName={item.personName || item.title}
                                                compact
                                                placeholder="Add a comment..."
                                                parentExpanded={isExpanded}
                                                disableFocusMode={isExpanded}
                                                onDetail={navigateToDetail}
                                                onShare={handleShare}
                                                fetchEnabled={isNearVisible}
                                                snapHeader
                                              />
                                            ) : (
                                              <CardComments
                                                entityType={commentEntityType}
                                                slug={item.slug}
                                                variant="inline"
                                                maxHeight="none"
                                                placeholder="Add a comment..."
                                                parentExpanded={isExpanded}
                                                disableFocusMode={isExpanded}
                                                onDetail={navigateToDetail}
                                                onShare={handleShare}
                                                fetchEnabled={isNearVisible}
                                                snapHeader
                                              />
                                            )}
                                          </div>
                                        </>
                                      )}
                                    </SnapPageVisibility>
                                  ) : null}
                                </div>
                              );
                            });
                          })()}
                          {!isMinimal && (
                            <SnapEndCard
                              category={cat}
                              sectionType={sectionType}
                              categories={categories}
                              onSelectCategory={handleCategorySelect}
                              onSuggest={onSuggest}
                              onBackToTop={() => {
                                const el = columnScrollRefs.current[cat];
                                if (el) el.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              onClose={onClose}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            </div>
          </SnapDismissContext.Provider>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
