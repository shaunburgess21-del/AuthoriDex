import { useEffect, useState, type ReactNode } from "react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useScrollHint } from "@/hooks/use-scroll-hint";

type ScrollState = "start" | "middle" | "end" | "none";

export function ScrollMaskedChipRow({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  useScrollHint(dragScrollRef);
  const [scrollState, setScrollState] = useState<ScrollState>("start");

  useEffect(() => {
    const el = dragScrollRef.current;
    if (!el) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const maxScroll = scrollWidth - clientWidth;
      if (maxScroll <= 2) {
        setScrollState("none");
        return;
      }
      if (scrollLeft <= 2) setScrollState("start");
      else if (scrollLeft >= maxScroll - 2) setScrollState("end");
      else setScrollState("middle");
    };

    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [children]);

  const maskClass =
    scrollState === "none"
      ? ""
      : scrollState === "start"
        ? "scroll-mask-right"
        : scrollState === "end"
          ? "scroll-mask-left"
          : "scroll-mask-both";

  return (
    <div
      ref={dragScrollRef}
      className={`flex items-center gap-2 overflow-x-auto scrollbar-hide ${maskClass} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
