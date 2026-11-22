import { useRef, type ReactNode } from "react";
import { useScrollEdgeFade } from "@/hooks/useScrollEdgeFade";
import { cn } from "@/lib/utils";

/**
 * Horizontal row that fades the edge still hiding content.
 * The fade follows scroll and resize. Callers keep their own
 * active-tab centering (scroll the active child into this scroller).
 */
export function HorizontalScrollFade({
  children,
  className,
  scrollerClassName,
}: {
  children: ReactNode;
  className?: string;
  scrollerClassName?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { edge, maskClass } = useScrollEdgeFade(scrollerRef);

  return (
    <div className={cn("relative min-w-0 max-w-full overflow-hidden", className)}>
      <div
        ref={scrollerRef}
        className={cn("flex w-full min-w-0 overflow-x-auto scrollbar-hide", maskClass, scrollerClassName)}
        data-scroll-edge={edge}
      >
        {children}
      </div>
    </div>
  );
}
