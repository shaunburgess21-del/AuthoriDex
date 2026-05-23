import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useMemo,
  type ReactNode,
} from "react";
import { MobileCardCarousel, type CardSectionHandle } from "@/components/MobileCardCarousel";
import { profileSectionGridClass } from "@/lib/profileSectionGridClass";

export type { CardSectionHandle };

interface CardSectionProps {
  children: ReactNode;
  desktopLimit?: number;
  columns?: 2 | 3;
  gap?: string;
  testIdPrefix?: string;
  dotActiveColor?: string;
  /** When true (e.g. profile Vote tab), center 1–2 cards on desktop like PredictTab sections. Default off for Vote/Predict pages. */
  centerShortRows?: boolean;
  /** Optional Tailwind min-height class applied to each mobile slide wrapper. Anchors Swiper container height so following siblings (dots) don't shift between variable-height cards. */
  mobileSlideMinHeight?: string;
}

function desktopChildKey(child: unknown, index: number): string | number {
  if (isValidElement(child) && child.key != null && child.key !== ".") {
    return child.key as string | number;
  }
  return `desktop-${index}`;
}

export const CardSection = forwardRef<CardSectionHandle, CardSectionProps>(function CardSection(
  {
    children,
    desktopLimit = 9,
    columns = 3,
    gap = "gap-5",
    testIdPrefix = "card-section",
    dotActiveColor = "bg-cyan-400",
    centerShortRows = false,
    mobileSlideMinHeight,
  },
  ref,
) {
  const items = useMemo(() => Children.toArray(children).filter(Boolean), [children]);
  const desktopItems = items.slice(0, desktopLimit);

  if (items.length === 0) return null;

  const gridCols = columns === 2
    ? "md:grid-cols-2"
    : "md:grid-cols-2 lg:grid-cols-3";

  const n = desktopItems.length;
  const shortRowLayout = centerShortRows ? profileSectionGridClass(n) : null;

  return (
    <div data-testid={testIdPrefix}>
      {centerShortRows && shortRowLayout ? (
        <div className="hidden md:block w-full">
          <div className={shortRowLayout.container}>
            {desktopItems.map((item, i) => {
              const key = desktopChildKey(item, i);
              if (shortRowLayout.item) {
                return (
                  <div key={key} className={shortRowLayout.item}>
                    {item}
                  </div>
                );
              }
              return <Fragment key={key}>{item}</Fragment>;
            })}
          </div>
        </div>
      ) : (
        <div className={`hidden md:grid grid-cols-1 ${gridCols} ${gap}`}>
          {desktopItems}
        </div>
      )}

      <div className="md:hidden">
        <MobileCardCarousel
          ref={ref}
          items={items}
          testIdPrefix={testIdPrefix}
          dotActiveColor={dotActiveColor}
          mobileSlideMinHeight={mobileSlideMinHeight}
        />
      </div>
    </div>
  );
});
