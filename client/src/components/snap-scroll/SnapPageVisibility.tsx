import { useEffect, useRef, useState, type ReactNode } from "react";

interface SnapPageVisibilityProps {
  scrollRoot: { current: HTMLElement | null };
  children: (state: { isNearVisible: boolean }) => ReactNode;
}

/**
 * Reports when a snap page is intersecting the column scroll root or within
 * ~1 viewport above/below — used to defer comment/insight fetches.
 */
export function SnapPageVisibility({ scrollRoot, children }: SnapPageVisibilityProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [isNearVisible, setIsNearVisible] = useState(false);

  useEffect(() => {
    const root = scrollRoot.current;
    const page = pageRef.current;
    if (!root || !page) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearVisible(entry.isIntersecting);
      },
      { root, rootMargin: "100% 0px 100% 0px", threshold: 0.01 },
    );
    observer.observe(page);
    return () => observer.disconnect();
  }, [scrollRoot]);

  return <div ref={pageRef} className="flex flex-col flex-1 min-h-0 w-full">{children({ isNearVisible })}</div>;
}
