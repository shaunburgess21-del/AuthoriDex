import { useLayoutEffect, useRef } from "react";

const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * Pixel box to pin on a card once `lock` turns on.
 * `stored` is the border-box height measured while the card was still resting,
 * so the post-vote render cannot grow the grid row.
 */
export function lockedVoteCardBox(
  lock: boolean,
  desktop: boolean,
  stored: number | null,
): { height: string; minHeight: string; maxHeight: string; overflow: "hidden" } | null {
  if (!lock || !desktop || stored == null || !(stored > 0)) return null;
  const px = `${Math.round(stored)}px`;
  return { height: px, minHeight: px, maxHeight: px, overflow: "hidden" };
}

/**
 * Keep a desktop hub card at the height it had before the vote.
 * The measurement is taken while `lock` is false (after layout, and again if
 * the card resizes). When `lock` becomes true the next layout paints that
 * same pixel height, so a taller post-vote state cannot stretch the grid row.
 * Mobile is left alone. Cards that mount already voted are not pinned.
 */
export function useLockedVoteCardHeight(lock: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const storedRef = useRef<number | null>(null);
  const lockRef = useRef(lock);
  lockRef.current = lock;

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof window === "undefined") return;
    const desktop = window.matchMedia(DESKTOP_QUERY).matches;
    const box = lockedVoteCardBox(lock, desktop, storedRef.current);
    if (!box) {
      node.style.height = "";
      node.style.minHeight = "";
      node.style.maxHeight = "";
      node.style.overflow = "";
      if (!lock && desktop) {
        storedRef.current = node.getBoundingClientRect().height;
      }
      if (lock) return;
      const observer = new ResizeObserver(() => {
        if (lockRef.current) return;
        if (!window.matchMedia(DESKTOP_QUERY).matches) return;
        storedRef.current = node.getBoundingClientRect().height;
      });
      observer.observe(node);
      return () => observer.disconnect();
    }
    node.style.height = box.height;
    node.style.minHeight = box.minHeight;
    node.style.maxHeight = box.maxHeight;
    node.style.overflow = box.overflow;
  }, [lock]);

  return ref;
}
