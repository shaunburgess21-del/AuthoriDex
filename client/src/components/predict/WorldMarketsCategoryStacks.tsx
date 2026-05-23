import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { MobileCardCarousel, type CardSectionHandle } from "@/components/MobileCardCarousel";

export type WorldMarketsCategoryGroup = {
  categoryId: string;
  markets: unknown[];
};

export interface WorldMarketsCategoryStacksProps {
  groups: WorldMarketsCategoryGroup[];
  renderMarket: (market: unknown) => ReactNode;
  testIdPrefix?: string;
  dotActiveColor?: string;
  mobileSlideMinHeight?: string;
}

export const WorldMarketsCategoryStacks = forwardRef<
  CardSectionHandle,
  WorldMarketsCategoryStacksProps
>(function WorldMarketsCategoryStacks(
  {
    groups,
    renderMarket,
    testIdPrefix = "section-community",
    dotActiveColor = "bg-violet-500",
    mobileSlideMinHeight = "min-h-[420px]",
  },
  ref,
) {
  const rowRefs = useRef<Map<string, CardSectionHandle | null>>(new Map());

  const rowKeys = useMemo(() => groups.map((g) => g.categoryId), [groups]);

  useImperativeHandle(
    ref,
    () => ({
      slideToKey: (key: string) => {
        for (const categoryId of rowKeys) {
          const handle = rowRefs.current.get(categoryId);
          if (handle?.slideToKey(key)) return true;
        }
        return false;
      },
    }),
    [rowKeys],
  );

  if (groups.length === 0) return null;

  return (
    <div className="md:hidden flex flex-col gap-6" data-testid={`${testIdPrefix}-stacks`}>
      {groups.map(({ categoryId, markets }) => {
        const slides = markets.map((market) => renderMarket(market));
        return (
          <MobileCardCarousel
            key={categoryId}
            ref={(handle) => {
              if (handle) rowRefs.current.set(categoryId, handle);
              else rowRefs.current.delete(categoryId);
            }}
            items={slides}
            testIdPrefix={`${testIdPrefix}-category-${categoryId}`}
            dotActiveColor={dotActiveColor}
            mobileSlideMinHeight={mobileSlideMinHeight}
          />
        );
      })}
    </div>
  );
});
