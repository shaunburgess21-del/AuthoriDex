import { useCallback, useEffect, useRef, useState } from "react";
import type { HubActivityFilter } from "@/lib/hub-activity-filter";
import {
  scrollTopToCenterCard,
  shouldReturnToVotedCard,
  type LastVotedAnchor,
} from "@/lib/voted-card-retain";
import type { HideExitQueue } from "@/hooks/useHideExitQueue";

export interface VotedCardSession {
  /** Remember a card voted during this visit while the not-yet filter is on. */
  note: (key: string) => void;
  /** The vote did not stick. Forget the anchor when it is this card. */
  clear: (key: string) => void;
  highlightKey: string | null;
  /** React key (the id half) of the card we are revealing past a desktop slice. */
  revealId: string | null;
  setRevealId: (id: string | null) => void;
  /** Mixed-feed window key, when the return target lives in that list. */
  feedFocusKey: string | null;
  setFeedFocusKey: (key: string | null) => void;
}

interface VotedCardSessionOptions {
  filter: HubActivityFilter;
  categoryKey: string;
  hideExit: HideExitQueue;
  /** True when the destination list still contains this retain key. */
  cardInList: (key: string) => boolean;
  /**
   * Bring the card into the rendered tree (carousel slide, feed window,
   * desktop slice) before we measure it.
   */
  prepare: (key: string) => void;
  sticky: () => { stickyTop: number; bandHeight: number };
}

function escapeAttr(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

/** The copy of the card that is actually on screen (desktop grid or mobile carousel). */
export function visibleVotedCard(key: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-voted-card="${escapeAttr(key)}"]`);
  for (const node of nodes) {
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (node.offsetParent === null && style.position !== "fixed") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    return node;
  }
  return null;
}

/**
 * Page-visit memory for the last card the user acted on, plus the one
 * scroll back to it when they switch to All or Votes/Positions only.
 * The anchor lives in memory for this mount, so a later visit does not
 * jump the page.
 */
export function useVotedCardSession(options: VotedCardSessionOptions): VotedCardSession {
  const visitIdRef = useRef(`visit-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);
  const anchorRef = useRef<LastVotedAnchor | null>(null);
  const filterRef = useRef(options.filter);
  const categoryRef = useRef(options.categoryKey);
  const appliedFilterRef = useRef(options.filter);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  filterRef.current = options.filter;

  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [revealId, setRevealId] = useState<string | null>(null);
  const [feedFocusKey, setFeedFocusKey] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const focusKeyRef = useRef<string | null>(null);

  const note = useCallback((key: string) => {
    if (filterRef.current !== "hide-mine" || !key) return;
    anchorRef.current = {
      key,
      visitId: visitIdRef.current,
      pendingReturn: true,
    };
  }, []);

  const clear = useCallback((key: string) => {
    if (anchorRef.current?.key === key) anchorRef.current = null;
  }, []);

  useEffect(() => {
    if (categoryRef.current === options.categoryKey) return;
    categoryRef.current = options.categoryKey;
    if (filterRef.current === "hide-mine") optionsRef.current.hideExit.collapseAll();
  }, [options.categoryKey]);

  useEffect(() => {
    const previous = appliedFilterRef.current;
    if (previous === options.filter) return;
    appliedFilterRef.current = options.filter;
    const anchor = anchorRef.current;
    const cardInList = anchor ? optionsRef.current.cardInList(anchor.key) : false;
    const should = shouldReturnToVotedCard({
      anchor,
      visitId: visitIdRef.current,
      previousFilter: previous,
      nextFilter: options.filter,
      cardInList,
    });
    if (anchor?.pendingReturn) {
      anchorRef.current = { ...anchor, pendingReturn: false };
    }
    optionsRef.current.hideExit.dropAll();
    if (!should || !anchor) {
      setFeedFocusKey(null);
      return;
    }
    optionsRef.current.prepare(anchor.key);
    focusKeyRef.current = anchor.key;
    setFocusTick((tick) => tick + 1);
    setHighlightKey(null);
  }, [options.filter]);

  useEffect(() => {
    const key = focusKeyRef.current;
    if (!key || focusTick === 0) return;
    let cancelled = false;
    let frames = 0;
    let settleFrame = 0;
    let highlightTimer = 0;
    const started = performance.now();

    const armHighlight = () => {
      if (cancelled) return;
      setHighlightKey(key);
      highlightTimer = window.setTimeout(() => {
        setHighlightKey((current) => (current === key ? null : current));
      }, 1500);
    };

    const waitUntilLanded = (target: number) => {
      const step = () => {
        if (cancelled) return;
        const close = Math.abs(window.scrollY - target) < 2;
        const gaveUp = performance.now() - started > 2000;
        if (close || gaveUp) {
          armHighlight();
          return;
        }
        settleFrame = window.requestAnimationFrame(step);
      };
      settleFrame = window.requestAnimationFrame(step);
    };

    const tick = () => {
      if (cancelled) return;
      const element = visibleVotedCard(key);
      if (!element) {
        if (frames < 45) {
          frames += 1;
          window.requestAnimationFrame(tick);
        }
        return;
      }
      const { stickyTop, bandHeight } = optionsRef.current.sticky();
      const rect = element.getBoundingClientRect();
      const top = scrollTopToCenterCard({
        scrollY: window.scrollY,
        cardTop: rect.top,
        cardHeight: rect.height,
        viewportHeight: window.innerHeight,
        stickyTopPx: stickyTop,
        bandHeightPx: bandHeight,
      });
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
      if (reduce || Math.abs(window.scrollY - top) < 2) armHighlight();
      else waitUntilLanded(top);
    };
    const frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(highlightTimer);
    };
  }, [focusTick]);

  return {
    note,
    clear,
    highlightKey,
    revealId,
    setRevealId,
    feedFocusKey,
    setFeedFocusKey,
  };
}
