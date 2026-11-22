import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { nextIntersectionWatch, scrollDeltaForRemovedSize } from "@/lib/voted-card-retain";
import { useVotedCardRetain, type VotedCardAccent } from "@/components/VotedCardRetainContext";

/**
 * Wraps a hub card that can be voted while "Not voted" is on.
 * The card stays put and shows its post-vote state. Once it has been on
 * screen and then leaves the viewport, it collapses. A card fully above
 * the viewport compensates document scroll so the content in view does
 * not jump. Horizontal carousel slides are removed on that frame; the
 * carousel corrects its index.
 */
export function HideExitCard({
  cardKey,
  exiting = false,
  children,
}: {
  cardKey?: string;
  /** Collapse now. Context can supply this as well. */
  exiting?: boolean;
  children: ReactNode;
}) {
  const retain = useVotedCardRetain();
  const ref = useRef<HTMLDivElement>(null);
  const wasVisibleRef = useRef(false);
  const onLeaveRef = useRef(retain?.onLeave);
  onLeaveRef.current = retain?.onLeave;
  const collapsing = exiting || (cardKey ? retain?.collapsing(cardKey) ?? false : false);
  const watch = !!cardKey && !!retain && !collapsing && retain.watching(cardKey);
  const highlighted = !!cardKey && retain?.highlightKey === cardKey;
  const accent: VotedCardAccent = retain?.accent ?? "cyan";

  useEffect(() => {
    if (!watch || !cardKey) return;
    const element = ref.current;
    if (!element) return;
    wasVisibleRef.current = false;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const decision = nextIntersectionWatch({
        phase: "retained",
        wasVisible: wasVisibleRef.current,
        isIntersecting: entry.isIntersecting,
      });
      wasVisibleRef.current = decision.wasVisible;
      if (!decision.release) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const inCarousel = !!element.closest(".swiper");
      const immediate = reduce || inCarousel;
      if (immediate) {
        const rect = element.getBoundingClientRect();
        const removed = rect.height;
        element.style.overflow = "hidden";
        element.style.height = "0px";
        element.style.marginTop = "0px";
        element.style.marginBottom = "0px";
        const delta = scrollDeltaForRemovedSize({
          cardStart: rect.top,
          cardEnd: rect.bottom,
          viewportStart: 0,
          viewportEnd: window.innerHeight,
          removed,
        });
        if (delta) window.scrollBy(0, delta);
      }
      onLeaveRef.current?.(cardKey, { immediate });
    }, { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [watch, cardKey]);

  useEffect(() => {
    if (!collapsing) return;
    const element = ref.current;
    if (!element) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rect = element.getBoundingClientRect();
    const start = rect.height;
    if (reduce || start <= 0) {
      const delta = scrollDeltaForRemovedSize({
        cardStart: rect.top,
        cardEnd: rect.bottom,
        viewportStart: 0,
        viewportEnd: window.innerHeight,
        removed: start,
      });
      element.style.overflow = "hidden";
      element.style.height = "0px";
      element.style.marginTop = "0px";
      element.style.marginBottom = "0px";
      if (delta) window.scrollBy(0, delta);
      return;
    }

    element.style.overflow = "hidden";
    element.style.height = `${start}px`;
    element.style.transition = "height 280ms ease-out, margin 280ms ease-out, opacity 280ms ease-out";
    let previous = start;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().height;
      const removed = previous - next;
      previous = next;
      if (removed <= 0) return;
      const box = element.getBoundingClientRect();
      const delta = scrollDeltaForRemovedSize({
        cardStart: box.top,
        cardEnd: box.bottom + removed,
        viewportStart: 0,
        viewportEnd: window.innerHeight,
        removed,
      });
      if (delta) window.scrollBy(0, delta);
    });
    observer.observe(element);
    const frame = window.requestAnimationFrame(() => {
      element.style.height = "0px";
      element.style.opacity = "0";
      element.style.marginTop = "0px";
      element.style.marginBottom = "0px";
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [collapsing]);

  return (
    <div
      ref={ref}
      data-voted-card={cardKey || undefined}
      data-testid={cardKey ? `voted-card-${cardKey}` : undefined}
      className={cn(
        "h-full min-w-0",
        highlighted && (accent === "blue" ? "voted-return-ring-blue" : "voted-return-ring"),
      )}
    >
      {children}
    </div>
  );
}
