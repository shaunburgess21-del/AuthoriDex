export type WindowedDotAccent = "cyan" | "violet";

export interface WindowedPaginationState {
  dotCount: number;
  windowStart: number;
  activeVisual: number;
}

const MAX_DOTS = 11;
const CENTER_INDEX = 5;

/** Sliding-window pagination: max 11 dots, active pins at center (index 5) in the middle range. */
export function getWindowedPaginationState(
  total: number,
  activeIndex: number,
): WindowedPaginationState {
  if (total <= 0) {
    return { dotCount: 0, windowStart: 0, activeVisual: 0 };
  }

  const dotCount = Math.min(MAX_DOTS, total);

  if (total <= MAX_DOTS) {
    return {
      dotCount,
      windowStart: 0,
      activeVisual: Math.min(activeIndex, total - 1),
    };
  }

  let windowStart: number;
  let activeVisual: number;

  if (activeIndex < 5) {
    windowStart = 0;
    activeVisual = activeIndex;
  } else if (activeIndex >= total - 5) {
    windowStart = total - MAX_DOTS;
    activeVisual = activeIndex - windowStart;
  } else {
    windowStart = activeIndex - CENTER_INDEX;
    activeVisual = CENTER_INDEX;
  }

  return { dotCount, windowStart, activeVisual };
}

function inactiveOpacityForSlot(slotIndex: number, dotCount: number): number {
  const centerIdx = (dotCount - 1) / 2;
  const maxDist = Math.max(centerIdx, dotCount - 1 - centerIdx) || 1;
  const distFromCenter = Math.abs(slotIndex - centerIdx);
  return 0.3 + 0.4 * (1 - Math.min(maxDist, distFromCenter) / maxDist);
}

const accentActiveClass: Record<WindowedDotAccent, string> = {
  cyan: "bg-cyan-400",
  violet: "bg-violet-500",
};

export function WindowedDotIndicator({
  totalSlides,
  activeIndex,
  onDotClick,
  accent,
  className = "",
  testIdPrefix = "windowed-dots",
}: {
  totalSlides: number;
  activeIndex: number;
  onDotClick: (slideIndex: number) => void;
  accent: WindowedDotAccent;
  className?: string;
  testIdPrefix?: string;
}) {
  if (totalSlides <= 1) return null;

  const safeActive = Math.max(0, Math.min(activeIndex, totalSlides - 1));
  const { dotCount, windowStart, activeVisual } = getWindowedPaginationState(
    totalSlides,
    safeActive,
  );

  const activeClass = accentActiveClass[accent];

  return (
    <div
      className={`flex justify-center items-center gap-1.5 mt-4 ${className}`.trim()}
      role="tablist"
      aria-label="Slide indicators"
      data-testid={`${testIdPrefix}-row`}
    >
      {Array.from({ length: dotCount }, (_, j) => {
        const slideIndex = windowStart + j;
        const isActive = j === activeVisual;
        const inactiveOp = inactiveOpacityForSlot(j, dotCount);

        return (
          <button
            key={slideIndex}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "true" : undefined}
            aria-label={`Go to slide ${slideIndex + 1} of ${totalSlides}`}
            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-[opacity,transform] duration-200 ease-in-out translate-x-0 ${
              isActive ? `${activeClass} opacity-100` : "bg-slate-500 dark:bg-slate-400"
            }`}
            style={isActive ? undefined : { opacity: inactiveOp }}
            onClick={() => onDotClick(slideIndex)}
            data-testid={`${testIdPrefix}-dot-${slideIndex}`}
          />
        );
      })}
    </div>
  );
}
