import { getAuthHeaders } from "./queryClient";
import { isFirstVisitSession } from "./firstVisit";

/**
 * Fire-and-forget product funnel telemetry (POST /api/funnel/event).
 * Patterned on insights-telemetry.ts: client-side batching queue, never
 * throws, never blocks UX. Anon identity is the server-side fdx_sid
 * cookie (sent via credentials: "include").
 */

interface FunnelEventPayload {
  eventType: string;
  surface: string;
  metadata?: Record<string, unknown>;
}

let pending: FunnelEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH = 25;

const SESSION_VOTES_KEY = "voxdex_funnel_session_votes";
const LIFETIME_VOTES_KEY = "voxdex_lifetime_vote_count";
const PAGE_LAND_SESSION_KEY = "voxdex_funnel_page_land_logged";

async function postEvent(event: FunnelEventPayload, headers: HeadersInit) {
  try {
    await fetch("/api/funnel/event", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(event),
      credentials: "include",
      keepalive: true,
    });
  } catch {
    /* fire-and-forget */
  }
}

async function flushEvents() {
  flushTimer = null;
  const batch = pending.splice(0, Math.min(pending.length, MAX_BATCH));
  if (batch.length === 0) return;

  let headers: HeadersInit = {};
  try {
    headers = await getAuthHeaders();
  } catch {
    headers = {};
  }

  await Promise.allSettled(batch.map((event) => postEvent(event, headers)));

  if (pending.length > 0 && !flushTimer) {
    flushTimer = setTimeout(() => void flushEvents(), FLUSH_INTERVAL_MS);
  }
}

export function logFunnelEvent(
  eventType: string,
  surface: string,
  metadata?: Record<string, unknown>,
): void {
  pending.push({ eventType, surface, metadata });
  if (pending.length > MAX_BATCH * 4) {
    pending.splice(0, pending.length - MAX_BATCH * 4);
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flushEvents(), FLUSH_INTERVAL_MS);
}

function readCounter(storage: Storage, key: string): number {
  try {
    const n = Number(storage.getItem(key));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCounter(storage: Storage, key: string, value: number): void {
  try {
    storage.setItem(key, String(value));
  } catch {
    /* quota / private mode */
  }
}

/** Lifetime votes recorded on this device (activation signal for nudges). */
export function getLifetimeVoteCount(): number {
  return readCounter(localStorage, LIFETIME_VOTES_KEY);
}

/** Votes cast this tab session (suppresses nudges once the visitor engages). */
export function getSessionVoteCount(): number {
  return readCounter(sessionStorage, SESSION_VOTES_KEY);
}

/**
 * Log a successful vote. Tracks the nth-vote-in-session so votes-per-
 * session distributions can be read straight off the events table, and
 * bumps the device lifetime counter used for nudge activation gates.
 */
export function trackVoteCast(
  surface: string,
  metadata?: Record<string, unknown>,
): void {
  const nth = readCounter(sessionStorage, SESSION_VOTES_KEY) + 1;
  writeCounter(sessionStorage, SESSION_VOTES_KEY, nth);
  writeCounter(localStorage, LIFETIME_VOTES_KEY, getLifetimeVoteCount() + 1);
  logFunnelEvent("vote_cast", surface, { ...metadata, nthInSession: nth });
}

/**
 * Log the session's landing page once per tab session (route changes
 * after landing are already covered by the server page_views table).
 */
export function trackPageLand(path: string): void {
  try {
    if (sessionStorage.getItem(PAGE_LAND_SESSION_KEY)) return;
    sessionStorage.setItem(PAGE_LAND_SESSION_KEY, "1");
  } catch {
    return;
  }
  logFunnelEvent("page_land", "app", {
    path,
    deviceClass: window.innerWidth < 768 ? "mobile" : "desktop",
    referrer: document.referrer || null,
    firstVisit: isFirstVisitSession(),
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (pending.length === 0) return;
    void flushEvents();
  });
}
