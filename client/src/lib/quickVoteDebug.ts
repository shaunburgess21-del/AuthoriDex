/**
 * Quick Vote on-device diagnostics.
 *
 * iOS Safari is the only place the Quick Vote snap deck has jammed, and it
 * cannot be driven from the dev machine. These URL flags turn on a small
 * HUD + event log and two bisection switches so a phone can report what the
 * scroller is doing. Everything here is a no-op unless a flag is present:
 *
 *   ?qvdebug=1              HUD + ring-buffer log (Copy log button)
 *   ?qvorder=rating-first   move all rating cards to the front of the deck
 *   ?qvstub=rating          render a static stub instead of OverallRatingCard
 *
 * Flags persist in sessionStorage so they survive the overlay's pushState
 * and a login round-trip. Clear the tab (or `?qvdebug=0`) to turn them off.
 */

export interface QvDebugFlags {
  hud: boolean;
  ratingFirst: boolean;
  stubRating: boolean;
}

const STORAGE_KEY = "qv-debug-flags";
const LOG_CAPACITY = 300;

let cachedFlags: QvDebugFlags | null = null;

function readFlagsUncached(): QvDebugFlags {
  const off: QvDebugFlags = { hud: false, ratingFirst: false, stubRating: false };
  if (typeof window === "undefined") return off;
  let flags: QvDebugFlags = off;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) flags = { ...off, ...(JSON.parse(stored) as Partial<QvDebugFlags>) };
  } catch {
    /* ignore */
  }
  try {
    const params = new URLSearchParams(window.location.search);
    let touched = false;
    if (params.has("qvdebug")) {
      flags = { ...flags, hud: params.get("qvdebug") !== "0" };
      touched = true;
    }
    if (params.has("qvorder")) {
      flags = { ...flags, ratingFirst: params.get("qvorder") === "rating-first" };
      touched = true;
    }
    if (params.has("qvstub")) {
      flags = { ...flags, stubRating: params.get("qvstub") === "rating" };
      touched = true;
    }
    if (touched) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* ignore */
  }
  return flags;
}

export function readQvDebugFlags(): QvDebugFlags {
  if (!cachedFlags) cachedFlags = readFlagsUncached();
  return cachedFlags;
}

/** Cheap guard for hot paths (scroll handlers). */
export function qvDebugEnabled(): boolean {
  return readQvDebugFlags().hud;
}

export interface QvLogEntry {
  t: number;
  kind: string;
  data?: Record<string, unknown>;
}

const ring: QvLogEntry[] = [];
const listeners = new Set<() => void>();
let version = 0;

function notify() {
  version += 1;
  listeners.forEach((fn) => fn());
}

/** Append an event. No-op unless the HUD flag is on. */
export function qvLog(kind: string, data?: Record<string, unknown>): void {
  if (!qvDebugEnabled()) return;
  ring.push({ t: Math.round(performance.now()), kind, data });
  if (ring.length > LOG_CAPACITY) ring.splice(0, ring.length - LOG_CAPACITY);
  notify();
}

export function qvLogEntries(): readonly QvLogEntry[] {
  return ring;
}

export function qvLogVersion(): number {
  return version;
}

export function qvLogClear(): void {
  ring.length = 0;
  notify();
}

export function qvLogSubscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Live gauges the HUD polls (not events): the snap view writes here when
 * the flag is on. Plain object so hot paths pay one property write.
 */
export const qvState: Record<string, string | number | boolean | null> = {};

export function qvSetState(patch: Record<string, string | number | boolean | null>): void {
  if (!qvDebugEnabled()) return;
  Object.assign(qvState, patch);
}

export function qvBump(key: string): void {
  if (!qvDebugEnabled()) return;
  const cur = qvState[key];
  qvState[key] = (typeof cur === "number" ? cur : 0) + 1;
}

/** Plain-text dump for the clipboard. */
export function qvLogToText(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const vv =
    typeof window !== "undefined" && window.visualViewport
      ? `${Math.round(window.visualViewport.width)}x${Math.round(window.visualViewport.height)} scale=${window.visualViewport.scale}`
      : "n/a";
  const header = [
    `QuickVote debug log — ${new Date().toISOString()}`,
    `UA: ${ua}`,
    `visualViewport: ${vv} innerHeight=${typeof window !== "undefined" ? window.innerHeight : "?"}`,
    `flags: ${JSON.stringify(readQvDebugFlags())}`,
    `state: ${JSON.stringify(qvState)}`,
    "",
  ];
  const lines = ring.map((e) => {
    const data = e.data ? " " + JSON.stringify(e.data) : "";
    return `${String(e.t).padStart(7)} ${e.kind}${data}`;
  });
  return header.concat(lines).join("\n");
}
