/**
 * UTC day bucket for notification groupKey scoping (e.g. collapse
 * all market_resolved rows from one resolution sweep into one inbox
 * head per user per calendar day).
 */
export function notificationDayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
