import { getAuthHeaders } from "./queryClient";
import type { InsightsEventPayload } from "@shared/insights/types";

let pending: InsightsEventPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL_MS = 250;
const MAX_BATCH = 25;

async function postEvent(event: InsightsEventPayload, headers: HeadersInit) {
  try {
    await fetch("/api/insights/event", {
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

export function logInsightsEvent(
  surface: string,
  action: string,
  params?: Record<string, unknown>,
): void {
  pending.push({ surface, action, params });
  if (pending.length > MAX_BATCH * 4) {
    pending.splice(0, pending.length - MAX_BATCH * 4);
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => void flushEvents(), FLUSH_INTERVAL_MS);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (pending.length === 0) return;
    void flushEvents();
  });
}
