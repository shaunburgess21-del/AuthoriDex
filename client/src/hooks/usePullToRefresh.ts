import { useRef, useState, useEffect, useCallback } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  maxPull?: number;
}

export function usePullToRefresh({ onRefresh, threshold = 60, maxPull = 100 }: UsePullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);

  pullDistanceRef.current = pullDistance;
  isRefreshingRef.current = isRefreshing;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh]);

  useEffect(() => {
    const isMobile = () => 'ontouchstart' in window;

    const getScrollTop = () => {
      return window.scrollY || document.documentElement.scrollTop || 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (!isMobile() || isRefreshingRef.current) return;
      if (getScrollTop() <= 0) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || isRefreshingRef.current) return;
      const deltaY = e.touches[0].clientY - startYRef.current;
      if (deltaY > 0 && getScrollTop() <= 0) {
        pullingRef.current = true;
        const clamped = Math.min(deltaY * 0.5, maxPull);
        setPullDistance(clamped);
        pullDistanceRef.current = clamped;
        if (clamped > 10) {
          e.preventDefault();
        }
      } else {
        startYRef.current = null;
        setPullDistance(0);
        pullDistanceRef.current = 0;
        pullingRef.current = false;
      }
    };

    const onTouchEnd = () => {
      if (!pullingRef.current) {
        startYRef.current = null;
        return;
      }
      startYRef.current = null;
      pullingRef.current = false;
      if (pullDistanceRef.current >= threshold) {
        handleRefresh();
      } else {
        setPullDistance(0);
        pullDistanceRef.current = 0;
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [threshold, maxPull, handleRefresh]);

  return { containerRef, pullDistance, isRefreshing };
}
