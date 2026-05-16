import {
  Children,
  Fragment,
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

/**
 * Imperative handle exposed via `forwardRef`. Used by PredictPage to slide
 * the carousel back to the card the user was viewing before they tapped
 * into a detail page. Plain `data-testid` polling can't restore position
 * here because the carousel runs in Swiper `virtual` mode — off-screen
 * slides aren't in the DOM at all (Sprint 5 / Phase 0 fix).
 */
export interface CardSectionHandle {
  /**
   * Jump the carousel to whichever slide has the given React `key`. No-op
   * (and returns `false`) on desktop where the layout is a static grid.
   * Returns `true` when a matching slide was found on mobile.
   */
  slideToKey: (key: string) => boolean;
}

function desktopChildKey(child: unknown, index: number): string | number {
  if (isValidElement(child) && child.key != null && child.key !== ".") {
    return child.key as string | number;
  }
  return `desktop-${index}`;
}

function mobileSlideKey(item: ReactNode, index: number): string {
  if (isValidElement(item) && item.key != null && item.key !== ".") {
    return String(item.key);
  }
  return `slide-${index}`;
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
  const dotActive: WindowedDotAccent = dotActiveColor.includes("violet") ? "violet" : "cyan";
  const [activeIndex, setActiveIndex] = useState(0);
  const swiperRef = useRef<SwiperType | null>(null);

  // Phase 0 fix: a pending slide-target queued by the parent before the
  // Swiper instance has finished mounting. We stash it here and drain in
  // an effect once `swiperRef.current` is populated. Without this the
  // imperative handle would no-op when called too early (e.g. immediately
  // after PredictPage mounts on Back-navigation).
  const pendingSlideKeyRef = useRef<string | null>(null);
  // Tracks whether the user has manually swiped or the parent has
  // explicitly slid this carousel since the last items.length change.
  // Once true we suppress the legacy "reset to slide 0 on data refetch"
  // behaviour so a programmatic slideToKey is not clobbered by an
  // unrelated query refresh.
  const userOrParentControlledRef = useRef(false);

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
        // Desktop renders a static grid; the parent should rely on the
        // existing `scrollToPredictAnchor` (DOM testId scroll) for that
        // path. We still record the index so a subsequent viewport
        // resize doesn't drop the intent.
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

  // Drain a queued slide target once the Swiper instance lands.
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
    // Legacy behaviour: when the underlying child list changes length we
    // snap back to slide 0 so dot indicators stay coherent. Phase 0
    // preserves this for ordinary data churn but skips it once a
    // user-driven swipe or a parent-driven `slideToKey` has taken over,
    // because otherwise a routine `/api/native-markets/updown` refetch
    // would clobber the restored slide position the moment the page
    // remounts after Back navigation.
    if (userOrParentControlledRef.current) return;
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
            userOrParentControlledRef.current = true;
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
            const slideKey = mobileSlideKey(item, i);
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
          onDotClick={(idx) => {
            userOrParentControlledRef.current = true;
            swiperRef.current?.slideTo(idx);
          }}
        />
      </div>
    </div>
  );
});
