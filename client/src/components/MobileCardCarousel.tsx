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
import { HIDE_EXIT_DWELL_MS } from "@/hooks/useHideExitQueue";

export interface CardSectionHandle {
  slideToKey: (key: string) => boolean;
  /**
   * After a successful mobile vote/prediction in inactive filter mode, let the
   * result state breathe briefly, then advance to the next card without hiding
   * or removing the voted card.
   */
  playVoteAdvance: (key: string) => void;
  /**
   * Advance the carousel as a voted card hides (Vote hub "Hidden" mode).
   * Slides the next card in from the right to hint swipeability, then the
   * parent removes the voted item; index is corrected so we land on the
   * adjacent card rather than snapping back to slide 0.
   */
  playHideExit: (key: string) => void;
}

export function mobileSlideKey(item: ReactNode, index: number): string {
  if (isValidElement(item) && item.key != null && item.key !== ".") {
    return String(item.key);
  }
  return `slide-${index}`;
}

function normalizeSlideKey(key: string): string {
  return key.startsWith(".$") ? key.slice(2) : key.startsWith(".") ? key.slice(1) : key;
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
    const voteAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Set when a hide-exit advance is in flight so the length-change effect
    // corrects the active index (instead of resetting to 0) once the voted
    // slide is spliced out of `items`.
    const pendingHideRef = useRef<{ idx: number; advanced: boolean } | null>(null);

    const modules = useMemo(() => (autoHeight ? [A11y] : [A11y, Virtual]), [autoHeight]);

    // Guard against calling updateAutoHeight() on a destroyed / not-yet-
    // initialised Swiper — that throws "Cannot read properties of undefined
    // (reading 'slidesPerView')" when the instance is torn down mid-rAF.
    const safeUpdateAutoHeight = useCallback((s: SwiperType | null | undefined) => {
      if (s && !s.destroyed && s.params) {
        s.updateAutoHeight();
      }
    }, []);

    const refreshAutoHeight = useCallback(() => {
      requestAnimationFrame(() => safeUpdateAutoHeight(swiperRef.current));
    }, [safeUpdateAutoHeight]);

    const slideToIndex = useCallback((idx: number) => {
      setActiveIndex(idx);
      userOrParentControlledRef.current = true;
      swiperRef.current?.slideTo(idx, 0);
    }, []);

    // Warm the images of every currently-rendered (virtual) slide so the
    // adjacent cards' images are fetched while the user looks at the active
    // card — kills the "black box until I swipe there" delay on slow links.
    // Virtual only mounts a small window, so this never floods the network.
    const warmRenderedSlideImages = useCallback(
      (s: SwiperType | null | undefined) => {
        if (!s || s.destroyed) return;
        requestAnimationFrame(() => {
          if (!s || s.destroyed) return;
          for (const slide of s.slides) {
            slide.querySelectorAll("img").forEach((node) => {
              const img = node as HTMLImageElement;
              if (img.loading !== "eager") img.loading = "eager";
            });
          }
        });
      },
      [],
    );

    const resolveKeyToIndex = useCallback(
      (key: string): number => {
        const normalizedKey = normalizeSlideKey(key);
        for (let i = 0; i < items.length; i++) {
          if (normalizeSlideKey(mobileSlideKey(items[i], i)) === normalizedKey) return i;
        }
        return -1;
      },
      [items],
    );

    useEffect(() => {
      return () => {
        if (voteAdvanceTimerRef.current) {
          clearTimeout(voteAdvanceTimerRef.current);
        }
      };
    }, []);

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
        playVoteAdvance: (key: string) => {
          const idx = resolveKeyToIndex(key);
          if (idx < 0 || idx >= items.length - 1) return;
          if (voteAdvanceTimerRef.current) {
            clearTimeout(voteAdvanceTimerRef.current);
          }
          voteAdvanceTimerRef.current = setTimeout(() => {
            voteAdvanceTimerRef.current = null;
            const swiper = swiperRef.current;
            if (!swiper || swiper.destroyed) return;
            const currentIdx = resolveKeyToIndex(key);
            if (currentIdx < 0 || currentIdx >= items.length - 1) return;
            if (swiper.activeIndex !== currentIdx) return;
            userOrParentControlledRef.current = true;
            swiper.slideNext(300);
          }, HIDE_EXIT_DWELL_MS);
        },
        playHideExit: (key: string) => {
          const swiper = swiperRef.current;
          if (!swiper || swiper.destroyed) return;
          const idx = resolveKeyToIndex(key);
          if (idx < 0) return;
          // Keep the length-change effect from snapping back to slide 0.
          userOrParentControlledRef.current = true;
          const isActive = idx === swiper.activeIndex;
          const hasNext = idx < items.length - 1;
          const advanced = isActive && hasNext;
          if (advanced) {
            // Next card slides in from the right (also a swipe-affordance hint).
            swiper.slideNext(300);
          }
          pendingHideRef.current = { idx, advanced };
        },
      }),
      [resolveKeyToIndex, slideToIndex, items.length],
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
      // A voted card was just spliced out (Hidden mode): correct the active
      // index so we stay on the adjacent card rather than resetting to 0.
      const pending = pendingHideRef.current;
      if (pending) {
        pendingHideRef.current = null;
        const swiper = swiperRef.current;
        // After slideNext we sit at idx+1; removing idx shifts us back by one.
        // For the last card (no advance) drop to the new last slide.
        const shift = pending.advanced || pending.idx <= activeIndex ? 1 : 0;
        const target = Math.max(0, Math.min(activeIndex - shift, items.length - 1));
        setActiveIndex(target);
        if (swiper && !swiper.destroyed) swiper.slideTo(target, 0);
        return;
      }
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
          virtual={
            autoHeight ? undefined : { addSlidesBefore: 1, addSlidesAfter: 2 }
          }
          pagination={false}
          onSwiper={(s) => {
            swiperRef.current = s;
            if (autoHeight) refreshAutoHeight();
            warmRenderedSlideImages(s);
          }}
          onSlideChange={(s) => {
            setActiveIndex(s.activeIndex);
            userOrParentControlledRef.current = true;
            if (autoHeight) safeUpdateAutoHeight(s);
            warmRenderedSlideImages(s);
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
