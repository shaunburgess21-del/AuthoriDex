/**
 * UTC day bucket for notification groupKey scoping (e.g. collapse
 * all market_resolved rows from one resolution sweep into one inbox
 * head per user per calendar day).
 */
export function notificationDayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * UTC month bucket for idempotency keys that should reset roughly
 * monthly (e.g. position-move milestones after a sell-out and re-buy).
 */
export function notificationMonthBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}
