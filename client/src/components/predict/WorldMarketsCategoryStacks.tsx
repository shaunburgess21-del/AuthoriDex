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
import type { CardSectionHandle } from "@/components/MobileCardCarousel";

export type WorldMarketsCategoryFilter = {
  id: string;
  label: string;
};

export interface WorldMarketsCategoryStacksProps {
  categoryFilters: WorldMarketsCategoryFilter[];
  activeCategory: string;
  onCategoryChange: (categoryId: string) => void;
  getMarketsForCategory: (categoryId: string) => unknown[];
  renderMarket: (market: unknown) => ReactNode;
  /** Resolve chip id for back-navigation restore (market id string). */
  resolveChipForMarketId?: (marketId: string) => string | null;
  testIdPrefix?: string;
}

export const WorldMarketsCategoryStacks = forwardRef<
  CardSectionHandle,
  WorldMarketsCategoryStacksProps
>(function WorldMarketsCategoryStacks(
  {
    categoryFilters,
    activeCategory,
    onCategoryChange,
    getMarketsForCategory,
    renderMarket,
    resolveChipForMarketId,
    testIdPrefix = "section-community",
  },
  ref,
) {
  const categorySwiperRef = useRef<SwiperType | null>(null);
  const suppressCategorySwipeRef = useRef(false);

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
    if (!categorySwiperRef.current) return;
    if (categorySwiperRef.current.activeIndex === activeFilterIndex) return;
    suppressCategorySwipeRef.current = true;
    categorySwiperRef.current.slideTo(activeFilterIndex, 0);
    requestAnimationFrame(() => {
      suppressCategorySwipeRef.current = false;
      refreshCategoryPagerHeight();
    });
  }, [activeFilterIndex, refreshCategoryPagerHeight]);

  useEffect(() => {
    requestAnimationFrame(() => refreshCategoryPagerHeight());
  }, [activeCategory, activeCategoryMarketCount, refreshCategoryPagerHeight]);

  useImperativeHandle(
    ref,
    () => ({
      slideToKey: (key: string) => {
        const chipId = resolveChipForMarketId?.(key);
        if (!chipId) return false;
        const idx = categoryFilters.findIndex((f) => f.id === chipId);
        if (idx < 0) return false;
        slideCategoryToIndex(idx);
        return false;
      },
    }),
    [categoryFilters, resolveChipForMarketId, slideCategoryToIndex],
  );

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
