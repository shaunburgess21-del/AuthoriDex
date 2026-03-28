import { useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperType } from "swiper";
import { ArrowLeft, Inbox } from "lucide-react";
import { sharePage } from "@/lib/share";
import { CategoryTabStrip } from "./CategoryTabStrip";
import { SnapScrollActionRow } from "./SnapScrollActionRow";
import { CommentsBottomSheet } from "./CommentsBottomSheet";
import { type CommentEntityType } from "@/components/comments/CardComments";
import "swiper/css";

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

export function VoteSnapScrollView({
  open,
  onClose,
  sectionType,
  items,
  initialItemId,
  renderCard,
}: VoteSnapScrollViewProps) {
  const [, setLocation] = useLocation();
  const swiperRef = useRef<SwiperType | null>(null);
  const scrollRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [activeCommentSlug, setActiveCommentSlug] = useState("");

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

  const categoryItems = useMemo(() => {
    const map = new Map<string, SnapItem[]>();
    map.set("All", items);
    for (const cat of categories) {
      if (cat === "All") continue;
      map.set(cat, items.filter((i) => i.category === cat));
    }
    return map;
  }, [items, categories]);

  const currentItems = categoryItems.get(activeCategory) || [];

  const visibleItemForComments = useRef<SnapItem | null>(null);

  const getVisibleItem = useCallback((cat: string): SnapItem | null => {
    const container = scrollRefs.current.get(cat);
    const catItems = categoryItems.get(cat) || [];
    if (!container || catItems.length === 0) return catItems[0] || null;

    const scrollTop = container.scrollTop;
    const frameHeight = container.clientHeight;
    const idx = Math.round(scrollTop / frameHeight);
    return catItems[Math.min(idx, catItems.length - 1)] || null;
  }, [categoryItems]);

  useEffect(() => {
    visibleItemForComments.current = getVisibleItem(activeCategory);
  }, [activeCategory, getVisibleItem]);

  useEffect(() => {
    if (!open || !initialItemId) return;
    const timer = setTimeout(() => {
      const cat = categories[initialCategoryIdx] || "All";
      const container = scrollRefs.current.get(cat);
      const catItems = categoryItems.get(cat) || [];
      const idx = catItems.findIndex((i) => i.id === initialItemId);
      if (container && idx > 0) {
        container.scrollTo({ top: idx * container.clientHeight, behavior: "auto" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open, initialItemId, initialCategoryIdx, categories, categoryItems]);

  const handleBack = useCallback(() => {
    if (commentsOpen) {
      setCommentsOpen(false);
      return;
    }
    onClose();
  }, [commentsOpen, onClose]);

  const handleCategorySelect = useCallback((cat: string) => {
    const idx = categories.indexOf(cat);
    if (idx >= 0) {
      setActiveCategoryIdx(idx);
      swiperRef.current?.slideTo(idx);
    }
  }, [categories]);

  const handleSlideChange = useCallback((swiper: SwiperType) => {
    setActiveCategoryIdx(swiper.activeIndex);
  }, []);

  const openComments = useCallback(() => {
    const item = getVisibleItem(activeCategory);
    if (item) {
      setActiveCommentSlug(item.slug);
      setCommentsOpen(true);
    }
  }, [activeCategory, getVisibleItem]);

  const navigateToDetail = useCallback(() => {
    const item = getVisibleItem(activeCategory);
    if (item?.slug) {
      onClose();
      setLocation(`${SECTION_DETAIL_PREFIX[sectionType]}${item.slug}`);
    }
  }, [activeCategory, getVisibleItem, sectionType, onClose, setLocation]);

  const handleShare = useCallback(() => {
    const item = getVisibleItem(activeCategory);
    if (item) {
      sharePage(item.title);
    }
  }, [activeCategory, getVisibleItem]);

  const handleScroll = useCallback((cat: string) => {
    visibleItemForComments.current = getVisibleItem(cat);
  }, [getVisibleItem]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-background flex flex-col"
        >
          {/* Header */}
          <div className="shrink-0 flex items-center border-b border-border/30 bg-background/95 backdrop-blur-md safe-top">
            <button
              onClick={handleBack}
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

          {/* Content: horizontal Swiper with vertical scroll-snap feeds */}
          <div className="flex-1 min-h-0">
            <Swiper
              onSwiper={(s) => { swiperRef.current = s; }}
              onSlideChange={handleSlideChange}
              slidesPerView={1}
              threshold={20}
              touchAngle={35}
              resistance
              resistanceRatio={0.5}
              initialSlide={initialCategoryIdx}
              className="h-full"
            >
              {categories.map((cat) => {
                const catItems = categoryItems.get(cat) || [];

                return (
                  <SwiperSlide key={cat} className="h-full">
                    {catItems.length === 0 ? (
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
                          if (el) scrollRefs.current.set(cat, el);
                          else scrollRefs.current.delete(cat);
                        }}
                        onScroll={() => handleScroll(cat)}
                        className="h-full overflow-y-auto snap-y snap-mandatory"
                        style={{ scrollSnapType: "y mandatory" }}
                      >
                        {catItems.map((item) => (
                          <div
                            key={item.id}
                            className="snap-start flex flex-col justify-center px-3"
                            style={{
                              height: "calc(100dvh - 52px)",
                              scrollSnapAlign: "start",
                            }}
                          >
                            <div className="flex-1 min-h-0 flex flex-col justify-center overflow-hidden">
                              {renderCard(item)}
                            </div>
                            <SnapScrollActionRow
                              onComments={openComments}
                              onDetail={navigateToDetail}
                              onShare={handleShare}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </SwiperSlide>
                );
              })}
            </Swiper>
          </div>

          {/* Comments bottom sheet */}
          <CommentsBottomSheet
            open={commentsOpen}
            onOpenChange={setCommentsOpen}
            entityType={SECTION_COMMENT_TYPE[sectionType]}
            slug={activeCommentSlug}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
