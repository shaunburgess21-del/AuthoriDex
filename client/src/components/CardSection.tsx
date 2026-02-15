import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CardSectionProps {
  children: ReactNode[];
  desktopLimit?: number;
  columns?: 2 | 3;
  gap?: string;
  testIdPrefix?: string;
}

export function CardSection({
  children,
  desktopLimit = 9,
  columns = 3,
  gap = "gap-5",
  testIdPrefix = "card-section",
}: CardSectionProps) {
  const items = children.filter(Boolean);
  const desktopItems = items.slice(0, desktopLimit);
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef(0);
  const touchDeltaX = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSwiping, setIsSwiping] = useState(false);

  const maxIndex = items.length - 1;

  const goTo = useCallback((index: number) => {
    setCurrentIndex(Math.max(0, Math.min(index, maxIndex)));
  }, [maxIndex]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDeltaX.current = 0;
    setIsSwiping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current;
  }, []);

  const handleTouchEnd = useCallback(() => {
    setIsSwiping(false);
    const threshold = 50;
    if (touchDeltaX.current < -threshold) {
      goTo(currentIndex + 1);
    } else if (touchDeltaX.current > threshold) {
      goTo(currentIndex - 1);
    }
    touchDeltaX.current = 0;
  }, [currentIndex, goTo]);

  useEffect(() => {
    if (currentIndex > maxIndex) {
      setCurrentIndex(Math.max(0, maxIndex));
    }
  }, [maxIndex, currentIndex]);

  if (items.length === 0) return null;

  const gridCols = columns === 2
    ? "md:grid-cols-2"
    : "md:grid-cols-2 lg:grid-cols-3";

  return (
    <div data-testid={testIdPrefix}>
      <div className={`hidden md:grid grid-cols-1 ${gridCols} ${gap}`}>
        {desktopItems}
      </div>

      <div className="md:hidden">
        <div
          ref={containerRef}
          className="relative overflow-hidden py-2"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          data-testid={`${testIdPrefix}-carousel`}
        >
          <div
            className="flex transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(-${currentIndex * 100}%)`,
              ...(isSwiping ? { transition: 'none' } : {}),
            }}
          >
            {items.map((item, i) => (
              <div
                key={i}
                className="w-full shrink-0 px-1"
                style={{ minWidth: '100%' }}
              >
                {item}
              </div>
            ))}
          </div>
        </div>

        {items.length > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={() => goTo(currentIndex - 1)}
              disabled={currentIndex === 0}
              className="h-7 w-7 rounded-full flex items-center justify-center border border-slate-700/50 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              data-testid={`${testIdPrefix}-prev`}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5" data-testid={`${testIdPrefix}-dots`}>
              {items.map((_, i) => (
                <button
                  key={i}
                  onClick={() => goTo(i)}
                  className={`rounded-full transition-all duration-200 ${
                    i === currentIndex
                      ? 'w-6 h-2 bg-cyan-400'
                      : 'w-2 h-2 bg-slate-600 hover:bg-slate-500'
                  }`}
                  data-testid={`${testIdPrefix}-dot-${i}`}
                />
              ))}
            </div>

            <button
              onClick={() => goTo(currentIndex + 1)}
              disabled={currentIndex === maxIndex}
              className="h-7 w-7 rounded-full flex items-center justify-center border border-slate-700/50 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              data-testid={`${testIdPrefix}-next`}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
