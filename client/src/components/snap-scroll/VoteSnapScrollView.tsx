import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Inbox, ChevronUp, ChevronDown } from "lucide-react";
import { sharePage } from "@/lib/share";
import {
  navigateWithVoteList,
  type VoteListHistoryState,
  type VoteListNavType,
} from "@/lib/voteListNavigation";
import { CategoryTabStrip } from "./CategoryTabStrip";
import { CardComments, type CommentEntityType } from "@/components/comments/CardComments";

export type SnapSectionType = "matchups" | "sentiment" | "opinion";

export interface SnapItem {
  id: string;
  slug: string;
  category: string;
  title: string;
}

interface VoteSnapScrollViewProps {
  open: boolean;
  onClose: () => void;
  sectionType: SnapSectionType;
  items: SnapItem[];
  initialItemId?: string;
  renderCard: (item: SnapItem) => ReactNode;
}

const SECTION_COMMENT_TYPE: Record<SnapSectionType, CommentEntityType> = {
  matchups: "matchup",
  sentiment: "poll",
  opinion: "opinion-poll",
};

const SECTION_DETAIL_PREFIX: Record<SnapSectionType, string> = {
  matchups: "/vote/matchups/",
  sentiment: "/polls/",
  opinion: "/vote/opinion-polls/",
};

const SECTION_LABEL: Record<SnapSectionType, string> = {
  matchups: "matchups",
  sentiment: "sentiment polls",
  opinion: "opinion polls",
};

const SNAP_TO_VOTE_LIST_TYPE: Record<SnapSectionType, VoteListNavType> = {
  matchups: "matchup",
  sentiment: "sentiment",
  opinion: "opinion",
};

const DRAG_THRESHOLD = 40;

export function VoteSnapScrollView({
  open,
  onClose,
  sectionType,
  items,
  initialItemId,
  renderCard,
}: VoteSnapScrollViewProps) {
  const [, setLocation] = useLocation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const dragStartY = useRef<number | null>(null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => cats.add(item.category));
    return ["All", ...Array.from(cats)];
  }, [items]);

  const initialCategoryIdx = useMemo(() => {
    if (!initialItemId) return 0;
    const item = items.find((i) => i.id === initialItemId);
    if (!item) return 0;
    const idx = categories.indexOf(item.category);
    return idx >= 0 ? idx : 0;
  }, [initialItemId, items, categories]);

  const [activeCategoryIdx, setActiveCategoryIdx] = useState(initialCategoryIdx);
  const activeCategory = categories[activeCategoryIdx] || "All";

  useEffect(() => {
    if (open) {
      setActiveCategoryIdx(initialCategoryIdx);
      setExpandedItemId(null);
    }
  }, [open, initialCategoryIdx]);

  const categoryItems = useMemo(() => {
    const map = new Map<string, SnapItem[]>();
    map.set("All", items);
    for (const cat of categories) {
      if (cat === "All") continue;
      map.set(cat, items.filter((i) => i.category === cat));
    }
    return map;
  }, [items, categories]);

  const getVisibleItem = useCallback((): SnapItem | null => {
    const catItems = categoryItems.get(activeCategory) || [];
    const container = scrollRef.current;
    if (!container || catItems.length === 0) return catItems[0] || null;

    const scrollTop = container.scrollTop;
    const frameHeight = container.clientHeight;
    const idx = Math.round(scrollTop / frameHeight);
    return catItems[Math.min(idx, catItems.length - 1)] || null;
  }, [categoryItems, activeCategory]);

  useEffect(() => {
    if (!open || !initialItemId) return;
    const timer = setTimeout(() => {
      const cat = categories[initialCategoryIdx] || "All";
      const catItems = categoryItems.get(cat) || [];
      const idx = catItems.findIndex((i) => i.id === initialItemId);
      if (scrollRef.current && idx > 0) {
        scrollRef.current.scrollTo({ top: idx * scrollRef.current.clientHeight, behavior: "auto" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open, initialItemId, initialCategoryIdx, categories, categoryItems]);

  const handleCategorySelect = useCallback((cat: string) => {
    const idx = categories.indexOf(cat);
    if (idx >= 0) {
      setActiveCategoryIdx(idx);
      setExpandedItemId(null);
    }
  }, [categories]);

  const navigateToDetail = useCallback(() => {
    const item = getVisibleItem();
    if (!item?.slug) return;
    const listItems = categoryItems.get(activeCategory) || [];
    const slugs = listItems.map((i) => i.slug).filter(Boolean);
    if (slugs.length === 0) return;
    const listType = SNAP_TO_VOTE_LIST_TYPE[sectionType];
    const voteList: VoteListHistoryState = {
      type: listType,
      slugs,
      currentSlug: item.slug,
      historyDepth: 1,
    };
    const path = `${SECTION_DETAIL_PREFIX[sectionType]}${encodeURIComponent(item.slug)}`;
    navigateWithVoteList(setLocation, voteList, path);
  }, [activeCategory, categoryItems, getVisibleItem, sectionType, setLocation]);

  const handleShare = useCallback(() => {
    const item = getVisibleItem();
    if (item) {
      sharePage(item.title);
    }
  }, [getVisibleItem]);

  const handleDragStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleDragEnd = useCallback((e: React.TouchEvent, itemId: string) => {
    if (dragStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - dragStartY.current;
    dragStartY.current = null;
    if (deltaY < -DRAG_THRESHOLD) {
      setExpandedItemId(itemId);
    } else if (deltaY > DRAG_THRESHOLD) {
      setExpandedItemId(null);
    }
  }, []);

  const activeItems = categoryItems.get(activeCategory) || [];
  const commentEntityType = SECTION_COMMENT_TYPE[sectionType];

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
              className="p-3 text-muted-foreground hover:text-foreground transition-colors"
              data-interactive="true"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 overflow-hidden">
              <CategoryTabStrip
                categories={categories}
                activeCategory={activeCategory}
                onSelect={handleCategorySelect}
              />
            </div>
          </div>

          {/* Vertical scroll-snap feed for active category */}
          <div className="flex-1 min-h-0">
            {activeItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-3 px-8">
                <Inbox className="h-10 w-10 opacity-40" />
                <p className="text-sm text-center">
                  No {SECTION_LABEL[sectionType]} in{" "}
                  <span className="font-semibold">{activeCategory}</span> yet
                </p>
              </div>
            ) : (
              <div
                key={activeCategory}
                ref={scrollRef}
                className="h-full overflow-y-auto snap-y snap-mandatory"
                style={{ scrollSnapType: "y mandatory" }}
              >
                {activeItems.map((item) => {
                  const isExpanded = expandedItemId === item.id;
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
                      {/* Vote card - hidden when comments expanded */}
                      <div
                        className={`w-full max-w-lg mx-auto shrink-0 transition-all duration-200 overflow-hidden ${
                          isExpanded ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
                        }`}
                      >
                        {renderCard(item)}
                      </div>

                      {/* Drag handle */}
                      <div
                        className="flex flex-col items-center py-1 cursor-grab active:cursor-grabbing touch-none select-none"
                        onTouchStart={handleDragStart}
                        onTouchEnd={(e) => handleDragEnd(e, item.id)}
                      >
                        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 text-muted-foreground/40 mt-0.5" />
                        ) : (
                          <ChevronUp className="h-3 w-3 text-muted-foreground/40 mt-0.5" />
                        )}
                      </div>

                      {/* Comments section */}
                      <div className="flex-1 min-h-0 overflow-y-auto max-w-lg mx-auto w-full">
                        <CardComments
                          entityType={commentEntityType}
                          slug={item.slug}
                          variant="inline"
                          maxHeight="none"
                          placeholder="Add a comment..."
                          onDetail={navigateToDetail}
                          onShare={handleShare}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
