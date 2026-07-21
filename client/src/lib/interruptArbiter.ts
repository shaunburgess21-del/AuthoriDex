/**
 * Interrupt arbiter — at most ONE proactive interrupt (nudge pill, welcome
 * toast, etc.) per tab session, with per-interrupt lifetime impression caps,
 * session dismissal, and permanent retirement on activation.
 *
 * Kernel patterns borrowed from matchup-neutral-nudge.ts: hydrate-once
 * in-memory cache, write-through storage, consume-on-show.
 */

const SESSION_USED_KEY = "voxdex_interrupt_session_used";
const SESSION_DISMISSED_PREFIX = "voxdex_interrupt_dismissed_";
const LIFETIME_IMPRESSIONS_PREFIX = "voxdex_interrupt_impressions_";
const ACTIVATED_PREFIX = "voxdex_interrupt_activated_";

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    /* private mode / quota */
  }
}

const local = () => window.localStorage;
const session = () => window.sessionStorage;

function lifetimeImpressions(id: string): number {
  const n = Number(safeGet(local, LIFETIME_IMPRESSIONS_PREFIX + id));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Another interrupt already claimed this session's slot. */
export function isSessionInterruptUsed(): boolean {
  return safeGet(session, SESSION_USED_KEY) === "1";
}

/** User accepted this interrupt at some point — never auto-show again. */
export function isInterruptActivated(id: string): boolean {
  return safeGet(local, ACTIVATED_PREFIX + id) === "1";
}

export function markInterruptActivated(id: string): void {
  safeSet(local, ACTIVATED_PREFIX + id, "1");
}

/** User dismissed this interrupt this session — re-eligible next visit. */
export function isInterruptDismissedThisSession(id: string): boolean {
  return safeGet(session, SESSION_DISMISSED_PREFIX + id) === "1";
}

export function dismissInterrupt(id: string): void {
  safeSet(session, SESSION_DISMISSED_PREFIX + id, "1");
}

/** Pure eligibility check — no consumption. */
export function canShowInterrupt(id: string, lifetimeCap: number): boolean {
  if (isSessionInterruptUsed()) return false;
  if (isInterruptActivated(id)) return false;
  if (isInterruptDismissedThisSession(id)) return false;
  return lifetimeImpressions(id) < lifetimeCap;
}

/**
 * Claim the session's single interrupt slot and count the impression.
 * Returns false if the interrupt is no longer eligible (e.g. another
 * interrupt fired between the eligibility check and the trigger).
 */
export function consumeInterrupt(id: string, lifetimeCap: number): boolean {
  if (!canShowInterrupt(id, lifetimeCap)) return false;
  safeSet(session, SESSION_USED_KEY, "1");
  safeSet(local, LIFETIME_IMPRESSIONS_PREFIX + id, String(lifetimeImpressions(id) + 1));
  return true;
}
