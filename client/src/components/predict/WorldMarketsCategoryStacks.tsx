import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import { MobileCardCarousel, type CardSectionHandle } from "@/components/MobileCardCarousel";
import { isPinnedCategory } from "@/lib/sectionCategoryFilters";

export type WorldMarketsCategoryGroup = {
  categoryId: string;
  markets: unknown[];
};

export type WorldMarketsCategoryFilter = {
  id: string;
  label: string;
};

export type WorldMarketsStackLayout = "grouped" | "single";

export type WorldMarketsRenderContext = "carousel" | "stack";

export interface WorldMarketsCategoryStacksProps {
  layout: WorldMarketsStackLayout;
  groups: WorldMarketsCategoryGroup[];
  categoryFilters: WorldMarketsCategoryFilter[];
  activeCategory: string;
  onCategoryChange: (categoryId: string) => void;
  getMarketsForCategory: (categoryId: string) => unknown[];
  renderMarket: (market: unknown, context?: WorldMarketsRenderContext) => ReactNode;
  /** Resolve chip id for back-navigation restore (market id string). */
  resolveChipForMarketId?: (marketId: string) => string | null;
  testIdPrefix?: string;
  dotActiveColor?: string;
}

function CategoryRowDivider() {
  return (
    <div
      className="mt-3 mb-[14px] border-t border-border/30 dark:border-slate-700/50"
      aria-hidden
      data-testid="world-markets-category-divider"
    />
  );
}

export const WorldMarketsCategoryStacks = forwardRef<
  CardSectionHandle,
  WorldMarketsCategoryStacksProps
>(function WorldMarketsCategoryStacks(
  {
    layout,
    groups,
    categoryFilters,
    activeCategory,
    onCategoryChange,
    getMarketsForCategory,
    renderMarket,
    resolveChipForMarketId,
    testIdPrefix = "section-community",
    dotActiveColor = "bg-violet-500",
  },
  ref,
) {
  const rowRefs = useRef<Map<string, CardSectionHandle | null>>(new Map());
  const categorySwiperRef = useRef<SwiperType | null>(null);
  const suppressCategorySwipeRef = useRef(false);

  const rowKeys = useMemo(() => groups.map((g) => g.categoryId), [groups]);

  const activeFilterIndex = useMemo(() => {
    const idx = categoryFilters.findIndex((f) => f.id === activeCategory);
    return idx >= 0 ? idx : 0;
  }, [categoryFilters, activeCategory]);

  const activeCategoryMarketCount = useMemo(
    () => getMarketsForCategory(activeCategory).length,
    [activeCategory, getMarketsForCategory],
  );

  const refreshCategoryPagerHeight = useCallback(() => {
    categorySwiperRef.current?.updateAutoHeight();
  }, []);

  const slideCategoryToIndex = useCallback(
    (index: number) => {
      const filter = categoryFilters[index];
      if (!filter) return;
      suppressCategorySwipeRef.current = true;
      categorySwiperRef.current?.slideTo(index, 0);
      if (filter.id !== activeCategory) {
        onCategoryChange(filter.id);
      }
      requestAnimationFrame(() => {
        suppressCategorySwipeRef.current = false;
        refreshCategoryPagerHeight();
      });
    },
    [categoryFilters, activeCategory, onCategoryChange, refreshCategoryPagerHeight],
  );

  useEffect(() => {
    if (layout !== "single" || !categorySwiperRef.current) return;
    if (categorySwiperRef.current.activeIndex === activeFilterIndex) return;
    suppressCategorySwipeRef.current = true;
    categorySwiperRef.current.slideTo(activeFilterIndex, 0);
    requestAnimationFrame(() => {
      suppressCategorySwipeRef.current = false;
      refreshCategoryPagerHeight();
    });
  }, [layout, activeFilterIndex, refreshCategoryPagerHeight]);

  useEffect(() => {
    if (layout !== "single") return;
    requestAnimationFrame(() => refreshCategoryPagerHeight());
  }, [layout, activeCategory, activeCategoryMarketCount, refreshCategoryPagerHeight]);

  useImperativeHandle(
    ref,
    () => ({
      slideToKey: (key: string) => {
        if (layout === "grouped") {
          for (const categoryId of rowKeys) {
            const handle = rowRefs.current.get(categoryId);
            if (handle?.slideToKey(key)) return true;
          }
          return false;
        }

        const chipId = resolveChipForMarketId?.(key);
        if (!chipId) return false;
        const idx = categoryFilters.findIndex((f) => f.id === chipId);
        if (idx < 0) return false;
        slideCategoryToIndex(idx);
        return false;
      },
    }),
    [layout, rowKeys, categoryFilters, resolveChipForMarketId, slideCategoryToIndex],
  );

  if (layout === "grouped") {
    if (groups.length === 0) return null;

    return (
      <div className="md:hidden flex flex-col" data-testid={`${testIdPrefix}-stacks`}>
        {groups.map(({ categoryId, markets }, rowIndex) => {
          const slides = markets.map((market) => renderMarket(market, "carousel"));
          const isLast = rowIndex === groups.length - 1;
          return (
            <div key={categoryId} data-testid={`${testIdPrefix}-row-${categoryId}`}>
              <MobileCardCarousel
                ref={(handle) => {
                  if (handle) rowRefs.current.set(categoryId, handle);
                  else rowRefs.current.delete(categoryId);
                }}
                items={slides}
                testIdPrefix={`${testIdPrefix}-category-${categoryId}`}
                dotActiveColor={dotActiveColor}
                autoHeight
              />
              {!isLast ? <CategoryRowDivider /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (categoryFilters.length === 0) return null;

  return (
    <div className="md:hidden relative w-full" data-testid={`${testIdPrefix}-category-pager`}>
      <Swiper
        modules={[A11y]}
        slidesPerView={1}
        autoHeight
        threshold={10}
        touchAngle={45}
        resistanceRatio={0.85}
        speed={300}
        initialSlide={activeFilterIndex}
        onSwiper={(s) => {
          categorySwiperRef.current = s;
          requestAnimationFrame(() => s.updateAutoHeight());
        }}
        onSlideChange={(s) => {
          s.updateAutoHeight();
          if (suppressCategorySwipeRef.current) return;
          const filter = categoryFilters[s.activeIndex];
          if (!filter || filter.id === activeCategory) return;
          onCategoryChange(filter.id);
        }}
        a11y={{
          enabled: true,
          prevSlideMessage: "Previous category",
          nextSlideMessage: "Next category",
        }}
        className="pt-0 pb-0"
        data-testid={`${testIdPrefix}-category-pager-carousel`}
      >
        {categoryFilters.map((filter) => {
          const markets = getMarketsForCategory(filter.id);
          if (isPinnedCategory(filter.id)) {
            return (
              <SwiperSlide key={filter.id}>
                <div className="w-full min-h-[1px]" aria-hidden />
              </SwiperSlide>
            );
          }
          return (
            <SwiperSlide key={filter.id}>
              <div className="flex flex-col gap-4 w-full px-1.5">
                {markets.length > 0 ? (
                  markets.map((market) => renderMarket(market))
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No markets in {filter.label}
                  </div>
                )}
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
});
