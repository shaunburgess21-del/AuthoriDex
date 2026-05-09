import { useState, useRef, useCallback, useEffect, useMemo, createContext, type ReactNode } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence, useMotionValue, useTransform, animate as motionAnimate } from "framer-motion";
import { ArrowLeft, ArrowUp, Inbox, MessageCircle, Plus, X } from "lucide-react";
import { getCategoryStyle } from "@/components/CategoryPill";
import { getMarketCategoryLabel, normalizeMarketCategory } from "@shared/constants";
import { sharePage } from "@/lib/share";
import {
  navigateWithVoteList,
  type VoteListHistoryState,
  type VoteListNavType,
} from "@/lib/voteListNavigation";
import { CategoryTabStrip } from "./CategoryTabStrip";
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
  title: string;
  personId?: string;
  personName?: string;
}

/** Incremented on horizontal category commit — descendants auto-dismiss overlays. */
export const SnapDismissContext = createContext(0);

interface VoteSnapScrollViewProps {
  open: boolean;
  onClose: () => void;
  sectionType: SnapSectionType;
  items: SnapItem[];
  initialItemId?: string;
  renderCard: (item: SnapItem) => ReactNode;
  onSuggest?: () => void;
  commentMode?: SnapCommentMode;
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

const H_PAN_LOCK_THRESHOLD = 10;
const H_VERTICAL_BIAS = 0.7;
const H_COMMIT_RATIO = 0.3;
const H_COMMIT_VELOCITY = 500;
const H_BOUNCE_RESISTANCE = 3;

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
        height: "calc(100dvh - 52px)",
        scrollSnapAlign: "start",
        paddingBottom: "env(safe-area-inset-bottom, 16px)",
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
}: VoteSnapScrollViewProps) {
  const [, setLocation] = useLocation();
  const commentScrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const dragStartY = useRef<number | null>(null);
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
  const [dismissCounter, setDismissCounter] = useState(0);

  // Canonical category ids (same pipeline as buildSectionCategoryOptions / filters)
  // so alias strings like "Food & Drink" vs "food-drink" collapse to one snap tab.
  const normalizedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        category: normalizeMarketCategory(item.category),
      })),
    [items],
  );

  // ── Categories ────────────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = new Set<string>();
    normalizedItems.forEach((item) => cats.add(item.category));
    const sorted = Array.from(cats).sort((a, b) =>
      getMarketCategoryLabel(a).localeCompare(getMarketCategoryLabel(b)),
    );
    return ["All", ...sorted];
  }, [normalizedItems]);

  const initialCategoryIdx = useMemo(() => {
    if (!initialItemId) return 0;
    const item = normalizedItems.find((i) => i.id === initialItemId);
    if (!item) return 0;
    const idx = categories.indexOf(item.category);
    return idx >= 0 ? idx : 0;
  }, [initialItemId, normalizedItems, categories]);

  const [activeCategoryIdx, setActiveCategoryIdx] = useState(initialCategoryIdx);
  const [visualCategoryIdx, setVisualCategoryIdx] = useState(initialCategoryIdx);
  const activeCategory = categories[activeCategoryIdx] || "All";
  const visualCategory = categories[visualCategoryIdx] || activeCategory;

  // Stable refs so non-passive listeners read current values without re-binding
  const activeCategoryIdxRef = useRef(activeCategoryIdx);
  activeCategoryIdxRef.current = activeCategoryIdx;
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  useEffect(() => {
    if (open) {
      setActiveCategoryIdx(initialCategoryIdx);
      setVisualCategoryIdx(initialCategoryIdx);
      setExpandedItemId(null);
      dragX.set(0);
      positionMemoryRef.current.clear();
      columnScrollRefs.current = {};
      isAnimatingRef.current = false;
      hPanRef.current = null;
    }
  }, [open, initialCategoryIdx, dragX]);

  const categoryItems = useMemo(() => {
    const map = new Map<string, SnapItem[]>();
    map.set("All", normalizedItems);
    for (const cat of categories) {
      if (cat === "All") continue;
      map.set(cat, normalizedItems.filter((i) => i.category === cat));
    }
    return map;
  }, [normalizedItems, categories]);

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
      });
    }
  }, []);

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

  // ── Initial scroll on open ────────────────────────────────────────────
  useEffect(() => {
    if (!open || !initialItemId) return;
    const timer = setTimeout(() => {
      const cat = categories[initialCategoryIdx] || "All";
      const catItems = categoryItems.get(cat) || [];
      const idx = catItems.findIndex((i) => i.id === initialItemId);
      const el = columnScrollRefs.current[cat];
      if (el && idx > 0) {
        el.scrollTo({ top: idx * el.clientHeight, behavior: "auto" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open, initialItemId, initialCategoryIdx, categories, categoryItems]);

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
      duration: 0.35,
      ease: [0.32, 0.72, 0, 1],
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
    hPanRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: performance.now(),
      locked: null,
    };
  }, []);

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

    const targetIdx = idx + (direction as number);
    if (direction !== 0 && targetIdx >= 0 && targetIdx < cats.length) {
      commitHorizontalSwipe(direction as -1 | 1);
    } else {
      springBack();
    }
  }, [commitHorizontalSwipe, springBack]);

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
      duration: 0.35,
      ease: [0.32, 0.72, 0, 1],
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
      if (item.personId) setLocation(`/person/${item.personId}`);
      return;
    }
    const listType = SNAP_TO_VOTE_LIST_TYPE[sectionType];
    if (listType) {
      const listItems = categoryItems.get(activeCategory) || [];
      const slugs = listItems.map((i) => i.slug).filter(Boolean);
      if (slugs.length > 0) {
        const voteList: VoteListHistoryState = {
          type: listType,
          slugs,
          currentSlug: item.slug,
          historyDepth: 1,
        };
        navigateWithVoteList(setLocation, voteList, `${detailPrefix}${encodeURIComponent(item.slug)}`);
        return;
      }
    }
    setLocation(`${detailPrefix}${encodeURIComponent(item.slug)}`);
  }, [activeCategory, categoryItems, getVisibleItem, sectionType, setLocation]);

  const handleShare = useCallback(() => {
    const item = getVisibleItem();
    if (item) sharePage(item.title);
  }, [getVisibleItem]);

  const handleDragStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleDragEnd = useCallback((e: React.TouchEvent, itemId: string) => {
    if (dragStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - dragStartY.current;
    dragStartY.current = null;
    if (deltaY < -DRAG_THRESHOLD) setExpandedItemId(itemId);
    else if (deltaY > DRAG_THRESHOLD) setExpandedItemId(null);
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

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[60] bg-background flex flex-col"
        >
          {/* Header */}
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
                  const isCurrent = slotIdx === 1;
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
                            if (el && !isCurrent) {
                              el.querySelectorAll("img").forEach((img) => {
                                (img as HTMLImageElement).loading = "lazy";
                              });
                              restoreScrollPosition(cat, el);
                            }
                          }}
                          className="h-full overflow-y-auto snap-y snap-mandatory"
                          style={{ scrollSnapType: "y mandatory" }}
                        >
                          {colItems.map((item) => {
                            const isExpanded = expandedItemId === item.id;

                            if (!hasComments) {
                              return (
                                <div
                                  key={item.id}
                                  className="snap-start flex flex-col items-center justify-center px-3 pt-3"
                                  style={{
                                    height: "calc(100dvh - 52px)",
                                    scrollSnapAlign: "start",
                                    paddingBottom: "env(safe-area-inset-bottom, 16px)",
                                  }}
                                >
                                  <div className="w-full max-w-lg mx-auto">
                                    {renderCard(item)}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={item.id}
                                className="snap-start flex flex-col px-3 pt-3"
                                style={{
                                  height: "calc(100dvh - 52px)",
                                  scrollSnapAlign: "start",
                                  paddingBottom: "env(safe-area-inset-bottom, 16px)",
                                }}
                              >
                                {/* Card — hidden when comments expanded */}
                                <div
                                  className={`w-full max-w-lg mx-auto shrink-0 transition-all duration-200 overflow-hidden ${
                                    isExpanded ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
                                  }`}
                                >
                                  {renderCard(item)}
                                </div>

                                {/* Drag handle / expand toggle */}
                                <div className="flex justify-center">
                                  {commentMode === "person" && !isExpanded ? (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedItemId(item.id)}
                                      className="flex items-center gap-2 px-5 py-2.5 mt-1 rounded-full border border-border/50 bg-muted/20 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 active:scale-[0.97]"
                                    >
                                      <MessageCircle className="h-3.5 w-3.5" />
                                      View Insights
                                    </button>
                                  ) : (
                                    <div
                                      className="flex flex-col items-center px-6 pt-3 pb-3 cursor-grab active:cursor-grabbing touch-none select-none"
                                      onTouchStart={handleDragStart}
                                      onTouchEnd={(e) => handleDragEnd(e, item.id)}
                                      onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                      role="button"
                                      aria-label={isExpanded ? "Collapse" : "Expand"}
                                    >
                                      <div className="w-16 h-1.5 rounded-full bg-muted-foreground/60" />
                                    </div>
                                  )}
                                </div>

                                {/* Comments / insights section */}
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
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
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
