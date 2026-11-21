/**
 * Countdown for the "Card hidden" toast only.
 *
 * Sonner pauses while the mouse hovers the toaster and while a pointer is
 * down. A finger on the toast also needs touch events, and the hover flag
 * is cleared whenever a single toast's list entry updates. This countdown
 * is the one timer for that toast: it holds while a fine pointer is over
 * the card or any finger is touching or pressing it, then continues with
 * the time that was left.
 */

export const HIDE_CARD_TOAST_DURATION_MS = 6_000;

export interface HoldPauseState {
  hovering: boolean;
  pointerDown: boolean;
  touchDown: boolean;
}

export type HoldPauseEvent =
  | { type: "pointerenter"; pointerType: string }
  | { type: "pointerleave"; pointerType: string }
  | { type: "pointerdown" }
  | { type: "pointerup" }
  | { type: "pointercancel" }
  | { type: "touchstart" }
  | { type: "touchend" }
  | { type: "touchcancel" };

export function initialHoldPauseState(): HoldPauseState {
  return { hovering: false, pointerDown: false, touchDown: false };
}

export function isHoldPaused(state: HoldPauseState): boolean {
  return state.hovering || state.pointerDown || state.touchDown;
}

export function holdPauseReducer(state: HoldPauseState, event: HoldPauseEvent): HoldPauseState {
  switch (event.type) {
    case "pointerenter":
      if (event.pointerType === "touch") return state;
      return { ...state, hovering: true };
    case "pointerleave":
      if (event.pointerType === "touch") return state;
      return { ...state, hovering: false };
    case "pointerdown":
      return { ...state, pointerDown: true };
    case "pointerup":
    case "pointercancel":
      return { ...state, pointerDown: false };
    case "touchstart":
      return { ...state, touchDown: true };
    case "touchend":
    case "touchcancel":
      return { ...state, touchDown: false };
    default:
      return state;
  }
}

export interface PauseListenable {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

function pointerTypeOf(event: Event): string {
  const value = (event as Event & { pointerType?: string }).pointerType;
  return typeof value === "string" ? value : "";
}

/** Pause while a fine pointer hovers the node, or a finger touches or presses it. */
export function attachHoldPause(
  target: PauseListenable,
  onPaused: (paused: boolean) => void,
): () => void {
  let state = initialHoldPauseState();
  const apply = (event: HoldPauseEvent) => {
    const next = holdPauseReducer(state, event);
    const wasPaused = isHoldPaused(state);
    state = next;
    const paused = isHoldPaused(state);
    if (wasPaused !== paused) onPaused(paused);
  };

  const listeners: Array<[string, (event: Event) => void]> = [
    ["pointerenter", (event) => apply({ type: "pointerenter", pointerType: pointerTypeOf(event) })],
    ["pointerleave", (event) => apply({ type: "pointerleave", pointerType: pointerTypeOf(event) })],
    ["pointerdown", () => apply({ type: "pointerdown" })],
    ["pointerup", () => apply({ type: "pointerup" })],
    ["pointercancel", () => apply({ type: "pointercancel" })],
    ["touchstart", () => apply({ type: "touchstart" })],
    ["touchend", () => apply({ type: "touchend" })],
    ["touchcancel", () => apply({ type: "touchcancel" })],
  ];

  for (const [type, listener] of listeners) target.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) target.removeEventListener(type, listener);
  };
}

export interface DismissCountdown {
  setPaused(paused: boolean): void;
  cancel(): void;
}

export function createDismissCountdown(options: {
  durationMs: number;
  onFire: () => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => number;
}): DismissCountdown {
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ??
    ((fn, ms) => window.setTimeout(fn, ms) as unknown as number);

  let remaining = options.durationMs;
  let paused = false;
  let fired = false;
  let startedAt = now();
  let generation = 0;

  const arm = (ms: number) => {
    const token = ++generation;
    schedule(() => {
      if (token !== generation || paused || fired) return;
      fired = true;
      options.onFire();
    }, ms);
  };

  arm(remaining);

  return {
    setPaused(next) {
      if (fired || paused === next) return;
      paused = next;
      generation += 1;
      if (next) {
        remaining -= now() - startedAt;
        return;
      }
      if (remaining <= 0) {
        fired = true;
        options.onFire();
        return;
      }
      startedAt = now();
      arm(remaining);
    },
    cancel() {
      if (fired) return;
      fired = true;
      generation += 1;
    },
  };
}
