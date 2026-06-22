import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Lifecycle phases for a card that has been voted on while the Vote hub's
 * "My Votes" filter is in Hidden (`hide-mine`) mode.
 *
 *  - `dwelling`  card stays mounted showing its results state (~DWELL_MS)
 *  - `exiting`   card plays its shrink/drift-into-the-toggle animation (~ANIM_MS)
 *  - `hidden`    card is removed from the display list permanently (for the session)
 *
 * The queue defers the (otherwise instant) removal of a voted card so the
 * results can breathe for a beat and then animate away toward the Hidden
 * toggle, instead of vanishing on the next render.
 */
export type HideExitPhase = "dwelling" | "exiting" | "hidden";

export const HIDE_EXIT_DWELL_MS = 900;
export const HIDE_EXIT_ANIM_MS = 450;

export interface HideExitQueue {
  /** Start the dwell -> exit -> hidden lifecycle for a card key. Idempotent. */
  beginExit: (key: string) => void;
  /**
   * Abort an in-flight lifecycle (e.g. the vote failed and was rolled back),
   * so the card is neither retained nor permanently hidden.
   */
  cancelExit: (key: string) => void;
  phaseOf: (key: string) => HideExitPhase | null;
  /** dwelling || exiting — card should stay rendered in the list. */
  isRetained: (key: string) => boolean;
  /** Card is mid fly-away animation. */
  isExiting: (key: string) => boolean;
  /** Lifecycle complete — card should be dropped from the list. */
  isHidden: (key: string) => boolean;
  /** Increments each time a card completes its fly-away (drives the toggle pulse). */
  pulseTick: number;
}

export interface UseHideExitQueueOptions {
  dwellMs?: number;
  animMs?: number;
  /** Fired when a key transitions dwelling -> exiting (used to drive the mobile carousel advance). */
  onExiting?: (key: string) => void;
}

export function useHideExitQueue(options?: UseHideExitQueueOptions): HideExitQueue {
  const dwellMs = options?.dwellMs ?? HIDE_EXIT_DWELL_MS;
  const animMs = options?.animMs ?? HIDE_EXIT_ANIM_MS;

  const onExitingRef = useRef(options?.onExiting);
  onExitingRef.current = options?.onExiting;

  const [phases, setPhases] = useState<Record<string, HideExitPhase>>({});
  const [pulseTick, setPulseTick] = useState(0);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((list) => list.forEach(clearTimeout));
    };
  }, []);

  const beginExit = useCallback(
    (key: string) => {
      // Already in the lifecycle — never restart it.
      if (timersRef.current[key]) return;

      setPhases((prev) => ({ ...prev, [key]: "dwelling" }));

      const timers: ReturnType<typeof setTimeout>[] = [];
      timers.push(
        setTimeout(() => {
          setPhases((prev) => (prev[key] ? { ...prev, [key]: "exiting" } : prev));
          onExitingRef.current?.(key);
        }, dwellMs),
      );
      timers.push(
        setTimeout(() => {
          setPhases((prev) => (prev[key] ? { ...prev, [key]: "hidden" } : prev));
          setPulseTick((t) => t + 1);
        }, dwellMs + animMs),
      );
      timersRef.current[key] = timers;
    },
    [dwellMs, animMs],
  );

  const cancelExit = useCallback((key: string) => {
    const timers = timersRef.current[key];
    if (timers) {
      timers.forEach(clearTimeout);
      delete timersRef.current[key];
    }
    setPhases((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const phaseOf = useCallback((key: string) => phases[key] ?? null, [phases]);
  const isRetained = useCallback(
    (key: string) => phases[key] === "dwelling" || phases[key] === "exiting",
    [phases],
  );
  const isExiting = useCallback((key: string) => phases[key] === "exiting", [phases]);
  const isHidden = useCallback((key: string) => phases[key] === "hidden", [phases]);

  return { beginExit, cancelExit, phaseOf, isRetained, isExiting, isHidden, pulseTick };
}
