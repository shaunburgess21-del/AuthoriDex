import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_VOTED_RETAIN,
  VOTED_CARD_COLLAPSE_MS,
  cancelVotedCard,
  collapseVotedCard,
  dropRetainedCards,
  hideVotedCard,
  isVotedCardCollapsing,
  isVotedCardHidden,
  isVotedCardRetained,
  retainVotedCard,
  type VotedRetainPhase,
  type VotedRetainState,
} from "@/lib/voted-card-retain";

/**
 * Cards voted while the hub filter is "not yet acted".
 *
 * The card stays mounted (`retained`, exposed as dwelling) so the post-vote
 * state can sit where the user left it. It collapses and then leaves only
 * when `release` runs (scrolled out of view) or the page drops the set
 * (filter, category, or navigation).
 *
 * `isRetained` / `isHidden` plug into `filterCardsByVoteActivity`.
 */
export type HideExitPhase = "dwelling" | "exiting" | "hidden";

export const HIDE_EXIT_DWELL_MS = 900;
export const HIDE_EXIT_ANIM_MS = VOTED_CARD_COLLAPSE_MS;

function toLegacyPhase(phase: VotedRetainPhase | undefined): HideExitPhase | null {
  if (phase === "retained") return "dwelling";
  if (phase === "collapsing") return "exiting";
  if (phase === "hidden") return "hidden";
  return null;
}

export interface HideExitQueue {
  /** Keep this card in the not-yet list. Idempotent. */
  beginExit: (key: string) => void;
  /** Vote rolled back. */
  cancelExit: (key: string) => void;
  /**
   * The card left the viewport. Collapse, then drop.
   * `immediate` skips the collapse (horizontal carousel, reduced motion).
   */
  release: (key: string, options?: { immediate?: boolean }) => void;
  /** Filter changed or the page is leaving. Drop held cards without a collapse. */
  dropAll: () => void;
  /** Category changed. Collapse cards that are still retained, then drop them. */
  collapseAll: () => void;
  phaseOf: (key: string) => HideExitPhase | null;
  isRetained: (key: string) => boolean;
  isExiting: (key: string) => boolean;
  isHidden: (key: string) => boolean;
  /** New object whenever the set changes. List memos depend on it. */
  snapshot: VotedRetainState;
  /** Increments when a card finishes leaving, so the eye pill can pulse. */
  pulseTick: number;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useHideExitQueue(): HideExitQueue {
  const [snapshot, setSnapshot] = useState<VotedRetainState>(EMPTY_VOTED_RETAIN);
  const [pulseTick, setPulseTick] = useState(0);
  const snapshotRef = useRef(snapshot);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const commit = useCallback((next: VotedRetainState) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const clearTimer = useCallback((key: string) => {
    const timer = timersRef.current[key];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[key];
    }
  }, []);

  const scheduleHide = useCallback((key: string) => {
    clearTimer(key);
    timersRef.current[key] = setTimeout(() => {
      delete timersRef.current[key];
      const next = hideVotedCard(snapshotRef.current, key);
      if (next !== snapshotRef.current) {
        snapshotRef.current = next;
        setSnapshot(next);
        setPulseTick((tick) => tick + 1);
      }
    }, VOTED_CARD_COLLAPSE_MS);
  }, [clearTimer]);

  const beginExit = useCallback((key: string) => {
    const next = retainVotedCard(snapshotRef.current, key);
    if (next !== snapshotRef.current) commit(next);
  }, [commit]);

  const cancelExit = useCallback((key: string) => {
    clearTimer(key);
    const next = cancelVotedCard(snapshotRef.current, key);
    if (next !== snapshotRef.current) commit(next);
  }, [clearTimer, commit]);

  const release = useCallback((key: string, options?: { immediate?: boolean }) => {
    if (snapshotRef.current.phases[key] !== "retained") return;
    const immediate = options?.immediate || prefersReducedMotion();
    if (immediate) {
      clearTimer(key);
      commit(hideVotedCard(snapshotRef.current, key));
      setPulseTick((tick) => tick + 1);
      return;
    }
    commit(collapseVotedCard(snapshotRef.current, key));
    scheduleHide(key);
  }, [clearTimer, commit, scheduleHide]);

  const dropAll = useCallback(() => {
    Object.keys(timersRef.current).forEach(clearTimer);
    const next = dropRetainedCards(snapshotRef.current, "hide");
    if (next !== snapshotRef.current) commit(next);
  }, [clearTimer, commit]);

  const collapseAll = useCallback(() => {
    if (prefersReducedMotion()) {
      Object.keys(timersRef.current).forEach(clearTimer);
      const next = dropRetainedCards(snapshotRef.current, "hide");
      if (next !== snapshotRef.current) {
        commit(next);
        setPulseTick((tick) => tick + 1);
      }
      return;
    }
    const prev = snapshotRef.current;
    const next = dropRetainedCards(prev, "collapse");
    if (next === prev) return;
    commit(next);
    for (const key of Object.keys(next.phases)) {
      if (next.phases[key] === "collapsing" && prev.phases[key] === "retained") {
        scheduleHide(key);
      }
    }
  }, [clearTimer, commit, scheduleHide]);

  const phaseOf = useCallback(
    (key: string) => toLegacyPhase(snapshotRef.current.phases[key]),
    [snapshot],
  );
  const isRetained = useCallback(
    (key: string) => isVotedCardRetained(snapshotRef.current.phases[key]),
    [snapshot],
  );
  const isExiting = useCallback(
    (key: string) => isVotedCardCollapsing(snapshotRef.current.phases[key]),
    [snapshot],
  );
  const isHidden = useCallback(
    (key: string) => isVotedCardHidden(snapshotRef.current.phases[key]),
    [snapshot],
  );

  return {
    beginExit,
    cancelExit,
    release,
    dropAll,
    collapseAll,
    phaseOf,
    isRetained,
    isExiting,
    isHidden,
    snapshot,
    pulseTick,
  };
}
