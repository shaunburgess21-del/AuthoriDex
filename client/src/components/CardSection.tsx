import { Children, Fragment, isValidElement, useMemo, useState, useRef, useEffect, type ReactNode } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Virtual } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/virtual";
import { WindowedDotIndicator, type WindowedDotAccent } from "@/components/WindowedDotIndicator";
import { profileSectionGridClass } from "@/lib/profileSectionGridClass";

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

export function CardSection({
  children,
  desktopLimit = 9,
  columns = 3,
  gap = "gap-5",
  testIdPrefix = "card-section",
  dotActiveColor = "bg-cyan-400",
  centerShortRows = false,
  mobileSlideMinHeight,
}: CardSectionProps) {
  const items = useMemo(() => Children.toArray(children).filter(Boolean), [children]);
  const desktopItems = items.slice(0, desktopLimit);
  const dotActive: WindowedDotAccent = dotActiveColor.includes("violet") ? "violet" : "cyan";
  const [activeIndex, setActiveIndex] = useState(0);
  const swiperRef = useRef<SwiperType | null>(null);

  useEffect(() => {
    setActiveIndex(0);
    swiperRef.current?.slideTo(0, 0);
  }, [items.length]);

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

      <div className="md:hidden relative w-full">
        <Swiper
          modules={[A11y, Virtual]}
          spaceBetween={0}
          slidesPerView={1}
          threshold={10}
          touchAngle={45}
          resistanceRatio={0.85}
          speed={300}
          cssMode={false}
          virtual
          pagination={false}
          onSwiper={(s) => {
            swiperRef.current = s;
          }}
          onSlideChange={(s) => {
            setActiveIndex(s.activeIndex);
            (document.activeElement as HTMLElement | undefined)?.blur?.();
          }}
          a11y={{
            enabled: true,
            prevSlideMessage: "Previous slide",
            nextSlideMessage: "Next slide",
          }}
          className="pt-0 pb-2 md:py-2"
          data-testid={`${testIdPrefix}-carousel`}
        >
          {items.map((item, i) => {
            const slideKey =
              isValidElement(item) && item.key != null && item.key !== "."
                ? String(item.key)
                : `slide-${i}`;
            return (
              <SwiperSlide key={slideKey} virtualIndex={i}>
                <div className={`w-full px-1.5 md:px-0${mobileSlideMinHeight ? ` ${mobileSlideMinHeight} flex flex-col [&>*]:h-full` : ""}`}>
                  {item}
                </div>
              </SwiperSlide>
            );
          })}
        </Swiper>
        <WindowedDotIndicator
          totalSlides={items.length}
          activeIndex={activeIndex}
          accent={dotActive}
          testIdPrefix={`${testIdPrefix}-dots`}
          onDotClick={(idx) => swiperRef.current?.slideTo(idx)}
        />
      </div>
    </div>
  );
}
