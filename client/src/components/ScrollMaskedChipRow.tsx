import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDragScroll } from "@/hooks/use-drag-scroll";
import { useScrollHint } from "@/hooks/use-scroll-hint";
import { cn } from "@/lib/utils";

type ScrollState = "start" | "middle" | "end" | "none";

export function ScrollMaskedChipRow({
  children,
  className = "",
  activeChipKey,
}: {
  children: ReactNode;
  className?: string;
  activeChipKey?: string;
}) {
  const dragScrollRef = useDragScroll<HTMLDivElement>();
  useScrollHint(dragScrollRef);
  const [scrollState, setScrollState] = useState<ScrollState>("start");

  useEffect(() => {
    if (!activeChipKey) return;
    const frameId = requestAnimationFrame(() => {
      const container = dragScrollRef.current;
      if (!container) return;
      const chip = container.querySelector<HTMLElement>(
        `[data-scroll-chip="${CSS.escape(activeChipKey)}"]`,
      );
      if (!chip) return;
      // Horizontal-only centering — scrollIntoView also scrolls the window vertically
      // when this row is off-screen (e.g. Curate section at the bottom of Vote page).
      const offset = chip.offsetLeft - container.clientWidth / 2 + chip.offsetWidth / 2;
      container.scrollTo({ left: Math.max(0, offset), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frameId);
  }, [activeChipKey]);

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

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = dragScrollRef.current;
    if (!el) return;
    const amount = Math.max(120, Math.round(el.clientWidth * 0.8));
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  }, []);

  const maskClass =
    scrollState === "none"
      ? ""
      : scrollState === "start"
        ? "scroll-mask-right"
        : scrollState === "end"
          ? "scroll-mask-left"
          : "scroll-mask-both";

  const showLeft = scrollState === "middle" || scrollState === "end";
  const showRight = scrollState === "start" || scrollState === "middle";

  return (
    <div className={cn("relative min-w-0", className)}>
      {showLeft && (
        <button
          type="button"
          aria-label="Scroll categories left"
          onClick={() => scrollByPage(-1)}
          className="absolute left-0 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground md:flex"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {showRight && (
        <button
          type="button"
          aria-label="Scroll categories right"
          onClick={() => scrollByPage(1)}
          className="absolute right-0 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground md:flex"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <div
        ref={dragScrollRef}
        className={cn(
          "flex items-center gap-2 overflow-x-auto scrollbar-hide",
          // Reserve space for desktop affordance buttons whenever the row overflows,
          // so chip positions don't jump as scroll state changes.
          scrollState !== "none" && "md:px-9",
          maskClass,
        )}
      >
        {children}
      </div>
    </div>
  );
}
