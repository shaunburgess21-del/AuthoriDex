/**
 * Caps auto-toast fanout during bursty notification inserts (e.g.
 * resolution nights). First N toasts per kind in a sliding window
 * render normally; subsequent ones update a single summary toast.
 */

export const TOAST_BURST_WINDOW_MS = 10_000;
export const TOAST_BURST_LIMIT = 2;

const BURST_SUMMARY_LABEL: Record<string, string> = {
  market_resolved: "markets resolved",
  market_void_refund: "refunds",
  credits_granted: "credit updates",
  announcement: "announcements",
};

export type ToastBurstDecision =
  | { action: "full" }
  | { action: "summary"; extra: number };

export class ToastBurstCoalescer {
  private recentByKind = new Map<string, number[]>();

  record(kind: string, now = Date.now()): ToastBurstDecision {
    const cutoff = now - TOAST_BURST_WINDOW_MS;
    const pruned = (this.recentByKind.get(kind) ?? []).filter((t) => t >= cutoff);
    pruned.push(now);
    this.recentByKind.set(kind, pruned);

    if (pruned.length <= TOAST_BURST_LIMIT) {
      return { action: "full" };
    }
    return { action: "summary", extra: pruned.length - TOAST_BURST_LIMIT };
  }

  summaryTitle(kind: string, extra: number): string {
    const label = BURST_SUMMARY_LABEL[kind] ?? "notifications";
    return `${extra} more ${label} — view all`;
  }

  summaryToastId(kind: string): string {
    return `notification-burst:${kind}`;
  }

  reset(): void {
    this.recentByKind.clear();
  }
}
