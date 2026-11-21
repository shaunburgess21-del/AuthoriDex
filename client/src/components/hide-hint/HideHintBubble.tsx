import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  HIDE_HINT_COPY,
  HIDE_HINT_VISIBLE_MS,
  placeHideHintBubble,
  type HideHintBox,
  type HideHintPlacement,
} from "@/lib/hideHintGate";

const BUBBLE_WIDTH = 216;

function toBox(rect: DOMRect): HideHintBox {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** Vote controls sit below the chip. Header buttons next to it are not obstacles. */
function collectVoteObstacles(anchor: HTMLElement): HideHintBox[] {
  const chip = anchor.getBoundingClientRect();
  let node: HTMLElement | null = anchor.parentElement;
  let card: HTMLElement | null = null;
  while (node && node !== document.body) {
    const buttons = node.querySelectorAll("button");
    for (const button of buttons) {
      if (button === anchor || anchor.contains(button)) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (rect.top >= chip.bottom + 48) {
        card = node;
        break;
      }
    }
    if (card) break;
    node = node.parentElement;
  }
  if (!card) return [];

  const obstacles: HideHintBox[] = [];
  card.querySelectorAll("button").forEach((button) => {
    if (button === anchor || anchor.contains(button)) return;
    const rect = button.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    if (rect.top < chip.bottom + 24) return;
    obstacles.push(toBox(rect));
  });
  return obstacles;
}

/**
 * Fixed-position note pointing at a category chip. It does not take space
 * in the card, does not take focus, and ignores pointer events so the chip
 * underneath still opens.
 */
export function HideHintBubble({
  anchor,
  onDone,
}: {
  anchor: HTMLElement;
  onDone: () => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finishedRef = useRef(false);
  const [placement, setPlacement] = useState<HideHintPlacement | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [announcement, setAnnouncement] = useState("");

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onDoneRef.current();
  }, []);

  const leave = useCallback(() => {
    setPhase((current) => (current === "out" ? current : "out"));
  }, []);

  const measure = useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble || !anchor.isConnected) return;
    const anchorRect = anchor.getBoundingClientRect();
    if (
      anchorRect.bottom <= 0 ||
      anchorRect.top >= window.innerHeight ||
      anchorRect.right <= 0 ||
      anchorRect.left >= window.innerWidth
    ) {
      leave();
      return;
    }
    const narrow = window.innerWidth < 768;
    const next = placeHideHintBubble({
      anchor: toBox(anchorRect),
      bubbleWidth: Math.min(BUBBLE_WIDTH, window.innerWidth - 16),
      bubbleHeight: bubble.offsetHeight || 48,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      obstacles: collectVoteObstacles(anchor),
      margin: 8,
      bottomInset: narrow ? 96 : 12,
    });
    setPlacement((current) => {
      if (
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.placement === next.placement &&
        current.arrowX === next.arrowX
      ) {
        return current;
      }
      return next;
    });
  }, [anchor, leave]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnnouncement(HIDE_HINT_COPY));
    const hideTimer = window.setTimeout(leave, HIDE_HINT_VISIBLE_MS);
    const onPointerDown = () => leave();
    document.addEventListener("pointerdown", onPointerDown, true);
    const reposition = () => measure();
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    const armScrollDismiss = window.setTimeout(() => {
      document.addEventListener("scroll", onPointerDown, true);
      document.addEventListener("wheel", onPointerDown, { capture: true, passive: true });
    }, 400);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer);
      window.clearTimeout(armScrollDismiss);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", reposition, true);
      document.removeEventListener("scroll", onPointerDown, true);
      document.removeEventListener("wheel", onPointerDown, true);
      window.removeEventListener("resize", reposition);
    };
  }, [leave, measure]);

  useEffect(() => {
    if (phase !== "out") return;
    const timer = window.setTimeout(finish, 280);
    return () => window.clearTimeout(timer);
  }, [phase, finish]);

  const width = placement?.width ?? Math.min(BUBBLE_WIDTH, typeof window !== "undefined" ? window.innerWidth - 16 : BUBBLE_WIDTH);

  return createPortal(
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <div
        ref={bubbleRef}
        aria-hidden
        data-phase={placement ? phase : "pending"}
        data-placement={placement?.placement ?? "below"}
        data-testid="hide-hint-bubble"
        className="hide-hint-bubble pointer-events-none fixed z-40 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover px-2.5 py-1.5 text-left text-[11px] leading-snug text-popover-foreground shadow-lg"
        style={{
          top: placement?.top ?? 0,
          left: placement?.left ?? 8,
          width,
          visibility: placement ? "visible" : "hidden",
        }}
      >
        <span
          aria-hidden
          className={
            placement?.placement === "above"
              ? "absolute h-2 w-2 rotate-45 border-b border-r border-border bg-popover"
              : "absolute h-2 w-2 rotate-45 border-l border-t border-border bg-popover"
          }
          style={{
            left: Math.max(10, (placement?.arrowX ?? 24) - 4),
            top: placement?.placement === "above" ? undefined : -4,
            bottom: placement?.placement === "above" ? -4 : undefined,
          }}
        />
        <p className="relative">{HIDE_HINT_COPY}</p>
      </div>
    </>,
    document.body,
  );
}

/** Soft inset glow on the chip. The pulse is dropped under reduced motion. */
export function HideHintChipGlow() {
  return (
    <span
      aria-hidden
      className="hide-hint-chip-glow pointer-events-none absolute inset-0 rounded-[inherit]"
    />
  );
}
