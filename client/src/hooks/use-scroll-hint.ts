import { useEffect, useRef, useCallback, RefObject } from "react";

export function useScrollHint<T extends HTMLElement = HTMLDivElement>(
  ref: RefObject<T | null>,
  { distance = 40, duration = 600, delay = 200 } = {}
) {
  const hasAnimated = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const animate = useCallback((el: T) => {
    const canScroll = el.scrollWidth > el.clientWidth;
    if (!canScroll) return;

    setTimeout(() => {
      const half = duration / 2;
      el.scrollTo({ left: distance, behavior: "smooth" });
      setTimeout(() => {
        el.scrollTo({ left: 0, behavior: "smooth" });
      }, half);
    }, delay);
  }, [distance, duration, delay]);

  useEffect(() => {
    const tryObserve = () => {
      const el = ref.current;
      if (!el || hasAnimated.current) return;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !hasAnimated.current) {
              hasAnimated.current = true;
              observer.disconnect();
              observerRef.current = null;
              animate(el);
            }
          }
        },
        { threshold: 0.5 }
      );

      observer.observe(el);
      observerRef.current = observer;
    };

    tryObserve();

    const interval = setInterval(tryObserve, 500);

    return () => {
      clearInterval(interval);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [ref, animate]);
}
