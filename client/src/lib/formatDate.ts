/**
 * Shared date/time formatting helpers.
 * Use these instead of duplicating format logic across components.
 */

/** Compact relative time: "just now", "12s ago", "5m ago", "2h ago", "3d ago", "2w ago" */
export function formatActivityAge(timestamp: string | Date): string {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

/**
 * Calendar date in UTC. The product shows times in UTC on purpose.
 * The year is included only when it is not the current UTC year,
 * so a recent May 1 stays "May 1" and last August becomes "Aug 31, 2025".
 */
export function formatUtcCalendarDate(date: Date, now: Date = new Date()): string {
  const includeYear = date.getUTCFullYear() !== now.getUTCFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Comment and reply age. Relative at every age:
 * "just now", "5m ago", "2h ago", "3d ago", "2w ago", "3 mo ago", "1 yr ago".
 */
export function formatCommentAge(dateStr: string | Date | null, now: Date = new Date()): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE_MS) return "just now";
  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / DAY_MS);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.max(1, Math.floor(days / 365))} yr ago`;
}

/** Exact UTC instant for a comment timestamp tooltip. */
export function formatUtcTimestampTitle(dateStr: string | Date | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = date.toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${formatted} UTC`;
}

/** Relative time with a UTC date for older items (>30d): "Just now", "5m ago", "2h ago", "3d ago", or "Jan 15" / "Jan 15, 2025" */
export function formatTimeAgo(dateStr: string | Date | null, now: Date = new Date()): string {
  if (!dateStr) return "Unknown";
  try {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "";
    const diff = now.getTime() - date.getTime();
    const minutes = Math.max(0, Math.floor(diff / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatUtcCalendarDate(date, now);
  } catch {
    return "";
  }
}

/** Short relative time: "5m ago", "2h ago", or full date for >24h */
export function formatRelativeTime(dateString: string | Date): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.max(0, Math.floor(diffMs / (1000 * 60)));
  const diffHours = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Full date: "Jan 15, 2025" */
export function formatDate(dateStr: string | Date): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(dateStr);
  }
}
