/**
 * Notification kinds + categories — shared types between client and server.
 *
 * The server-side mirror lives at `server/services/notifications.ts`. Keep
 * both lists in sync; the registry in `./registry.ts` adds icon/accent
 * metadata that's only relevant on the client.
 */

export type NotificationKind =
  | "market_resolved"
  | "market_closing_soon"
  | "market_void_refund"
  | "position_move_alert"
  | "weekly_pnl_digest"
  | "position_resolution_imminent"
  | "favorite_rank_cross"
  | "favorite_hot_mover"
  | "favorite_new_market"
  | "comment_reply"
  | "comment_like"
  | "comment_upvote_milestone"
  | "rank_up"
  | "streak_milestone"
  | "credits_low"
  | "credits_granted"
  | "badge_awarded"
  | "trade_executed"
  | "announcement";

export type NotificationCategory =
  | "predictions"
  | "favorites"
  | "social"
  | "account"
  | "system";

/**
 * Wire shape returned by GET /api/me/notifications. Mirrors the Drizzle
 * schema row but trimmed of fields the client doesn't need (and with
 * Date fields serialized to ISO strings).
 */
export interface NotificationRow {
  id: string;
  userId: string;
  kind: NotificationKind | string; // tolerate forward-compat unknowns
  category: NotificationCategory | string;
  title: string;
  body: string | null;
  href: string | null;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  priority: number;
  groupKey: string | null;
  idempotencyKey: string;
  seenAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  /**
   * Client-only — set by `flattenNotifications` when rows are collapsed
   * by `groupKey`. When present and > 0 this row is the most recent of
   * a group of N+1 rows; the UI renders a small "+N earlier" pill next
   * to the timestamp so the user can see how many were folded. Never
   * present on the wire; never present when collapsing is opted out
   * (e.g. on the full archive page).
   */
  collapsedCount?: number;
}

export interface NotificationListResponse {
  items: NotificationRow[];
  nextCursor: string | null;
}

export interface NotificationCountsResponse {
  unread: number;
  unseen: number;
  cap: number;
}

export interface NotificationPreferences {
  userId: string;
  predictionsInApp: boolean;
  favoritesInApp: boolean;
  socialInApp: boolean;
  accountInApp: boolean;
  systemInApp: boolean;
  predictionsEmail: boolean;
  favoritesEmail: boolean;
  socialEmail: boolean;
  accountEmail: boolean;
  systemEmail: boolean;
  predictionsPush: boolean;
  favoritesPush: boolean;
  socialPush: boolean;
  accountPush: boolean;
  systemPush: boolean;
  /** When true, swipe-right dismisses and swipe-left marks read (mobile inbox). */
  invertNotificationSwipe: boolean;
  updatedAt: string;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  "predictions",
  "favorites",
  "social",
  "account",
  "system",
];

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  predictions: "Predictions & markets",
  favorites: "Favorites",
  social: "Replies & mentions",
  account: "Account & gamification",
  system: "Announcements",
};

export const CATEGORY_SHORT_LABELS: Record<NotificationCategory, string> = {
  predictions: "Predictions",
  favorites: "Favorites",
  social: "Replies",
  account: "Account",
  system: "System",
};
