import {
  forwardRef,
  isValidElement,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { A11y, Virtual } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css";
import "swiper/css/virtual";
import { WindowedDotIndicator, type WindowedDotAccent } from "@/components/WindowedDotIndicator";

export interface CardSectionHandle {
  slideToKey: (key: string) => boolean;
}

export function mobileSlideKey(item: ReactNode, index: number): string {
  if (isValidElement(item) && item.key != null && item.key !== ".") {
    return String(item.key);
  }
  return `slide-${index}`;
}

export interface MobileCardCarouselProps {
  items: ReactNode[];
  testIdPrefix: string;
  dotActiveColor?: string;
  mobileSlideMinHeight?: string;
  className?: string;
  /** When false, dots are hidden (e.g. single-market rows still skip via totalSlides <= 1). */
  showDots?: boolean;
  /**
   * Collapse Swiper height to the active slide (content-sized cards).
   * Disables Virtual slides; use for World Markets grouped rows.
   */
  autoHeight?: boolean;
}

export const MobileCardCarousel = forwardRef<CardSectionHandle, MobileCardCarouselProps>(
  function MobileCardCarousel(
    {
      items,
      testIdPrefix,
      dotActiveColor = "bg-cyan-400",
      mobileSlideMinHeight,
      className,
      showDots = true,
      autoHeight = false,
    },
    ref,
  ) {
    const dotActive: WindowedDotAccent = dotActiveColor.includes("violet") ? "violet" : "cyan";
    const [activeIndex, setActiveIndex] = useState(0);
    const swiperRef = useRef<SwiperType | null>(null);
    const pendingSlideKeyRef = useRef<string | null>(null);
    const userOrParentControlledRef = useRef(false);

    const modules = useMemo(() => (autoHeight ? [A11y] : [A11y, Virtual]), [autoHeight]);

    const refreshAutoHeight = useCallback(() => {
      requestAnimationFrame(() => swiperRef.current?.updateAutoHeight());
    }, []);

    const slideToIndex = useCallback((idx: number) => {
      setActiveIndex(idx);
      userOrParentControlledRef.current = true;
      swiperRef.current?.slideTo(idx, 0);
    }, []);

    const resolveKeyToIndex = useCallback(
      (key: string): number => {
        for (let i = 0; i < items.length; i++) {
          if (mobileSlideKey(items[i], i) === key) return i;
        }
        return -1;
      },
      [items],
    );

    useImperativeHandle(
      ref,
      () => ({
        slideToKey: (key: string) => {
          const idx = resolveKeyToIndex(key);
          if (idx < 0) return false;
          if (swiperRef.current) {
            slideToIndex(idx);
          } else {
            pendingSlideKeyRef.current = key;
          }
          return true;
        },
      }),
      [resolveKeyToIndex, slideToIndex],
    );

    useEffect(() => {
      if (!swiperRef.current) return;
      const pending = pendingSlideKeyRef.current;
      if (!pending) return;
      const idx = resolveKeyToIndex(pending);
      if (idx >= 0) {
        pendingSlideKeyRef.current = null;
        slideToIndex(idx);
      }
    });

    useEffect(() => {
      if (userOrParentControlledRef.current) return;
      setActiveIndex(0);
      swiperRef.current?.slideTo(0, 0);
    }, [items.length]);

    useEffect(() => {
      if (!autoHeight) return;
      refreshAutoHeight();
    }, [items, autoHeight, refreshAutoHeight]);

    if (items.length === 0) return null;

    return (
      <div className={className ?? "relative w-full"} data-testid={testIdPrefix}>
        <Swiper
          modules={modules}
          spaceBetween={0}
          slidesPerView={1}
          threshold={10}
          touchAngle={45}
          resistanceRatio={0.85}
          speed={300}
          cssMode={false}
          autoHeight={autoHeight}
          virtual={autoHeight ? undefined : true}
          pagination={false}
          onSwiper={(s) => {
            swiperRef.current = s;
            if (autoHeight) refreshAutoHeight();
          }}
          onSlideChange={(s) => {
            setActiveIndex(s.activeIndex);
            userOrParentControlledRef.current = true;
            if (autoHeight) s.updateAutoHeight();
            (document.activeElement as HTMLElement | undefined)?.blur?.();
          }}
          a11y={{
            enabled: true,
            prevSlideMessage: "Previous slide",
            nextSlideMessage: "Next slide",
          }}
          className="pt-0 pb-2"
          data-testid={`${testIdPrefix}-carousel`}
        >
          {items.map((item, i) => {
            const slideKey = mobileSlideKey(item, i);
            return (
              <SwiperSlide key={slideKey} {...(autoHeight ? {} : { virtualIndex: i })}>
                <div
                  className={`w-full px-1.5${mobileSlideMinHeight ? ` ${mobileSlideMinHeight} flex flex-col [&>*]:h-full` : ""}`}
                >
                  {item}
                </div>
              </SwiperSlide>
            );
          })}
        </Swiper>
        {showDots ? (
          <WindowedDotIndicator
            totalSlides={items.length}
            activeIndex={activeIndex}
            accent={dotActive}
            testIdPrefix={`${testIdPrefix}-dots`}
            onDotClick={(idx) => {
              userOrParentControlledRef.current = true;
              swiperRef.current?.slideTo(idx);
            }}
          />
        ) : null}
      </div>
    );
  },
);
