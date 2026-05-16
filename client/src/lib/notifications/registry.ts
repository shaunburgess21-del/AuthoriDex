import type { LucideIcon } from "lucide-react";
import {
  Award,
  Bell,
  CreditCard,
  Flame,
  Megaphone,
  MessageSquare,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Timer,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import type { NotificationCategory, NotificationKind } from "./types";

/**
 * Single source of truth for how each notification kind is rendered:
 *   - icon  (lucide component)
 *   - accent (tailwind text-color token used for the icon tint)
 *   - bgAccent (tailwind bg-color token used for the icon chip)
 *   - priority (1 = auto-toast on arrival; 0 = silent in bell)
 *   - category (which preference toggle gates this kind)
 *
 * The server only knows category + priority; visual presentation is a
 * pure-client concern, intentionally kept here so we can iterate on
 * iconography without touching the data layer.
 */
export interface KindMeta {
  icon: LucideIcon;
  accent: string;
  bgAccent: string;
  category: NotificationCategory;
  priority: 0 | 1;
}

const PREDICTIONS_ACCENT = "text-violet-600 dark:text-violet-400";
const PREDICTIONS_BG = "bg-violet-500/15 dark:bg-violet-500/10";
const FAVORITES_ACCENT = "text-amber-600 dark:text-amber-400";
const FAVORITES_BG = "bg-amber-500/15 dark:bg-amber-500/10";
const SOCIAL_ACCENT = "text-cyan-600 dark:text-cyan-400";
const SOCIAL_BG = "bg-cyan-500/15 dark:bg-cyan-500/10";
const ACCOUNT_ACCENT = "text-emerald-600 dark:text-emerald-400";
const ACCOUNT_BG = "bg-emerald-500/15 dark:bg-emerald-500/10";
const SYSTEM_ACCENT = "text-blue-600 dark:text-blue-400";
const SYSTEM_BG = "bg-blue-500/15 dark:bg-blue-500/10";
const NEUTRAL_ACCENT = "text-muted-foreground";
const NEUTRAL_BG = "bg-muted";

export const NOTIFICATION_REGISTRY: Record<NotificationKind, KindMeta> = {
  market_resolved: {
    icon: Trophy,
    accent: PREDICTIONS_ACCENT,
    bgAccent: PREDICTIONS_BG,
    category: "predictions",
    priority: 1,
  },
  market_closing_soon: {
    icon: Timer,
    accent: PREDICTIONS_ACCENT,
    bgAccent: PREDICTIONS_BG,
    category: "predictions",
    priority: 0,
  },
  market_void_refund: {
    icon: RefreshCcw,
    accent: PREDICTIONS_ACCENT,
    bgAccent: PREDICTIONS_BG,
    category: "predictions",
    priority: 1,
  },
  favorite_rank_cross: {
    icon: TrendingUp,
    accent: FAVORITES_ACCENT,
    bgAccent: FAVORITES_BG,
    category: "favorites",
    priority: 0,
  },
  favorite_hot_mover: {
    icon: Flame,
    accent: FAVORITES_ACCENT,
    bgAccent: FAVORITES_BG,
    category: "favorites",
    priority: 0,
  },
  favorite_new_market: {
    icon: Sparkles,
    accent: FAVORITES_ACCENT,
    bgAccent: FAVORITES_BG,
    category: "favorites",
    priority: 0,
  },
  comment_reply: {
    icon: MessageSquare,
    accent: SOCIAL_ACCENT,
    bgAccent: SOCIAL_BG,
    category: "social",
    priority: 0,
  },
  comment_upvote_milestone: {
    icon: ThumbsUp,
    accent: SOCIAL_ACCENT,
    bgAccent: SOCIAL_BG,
    category: "social",
    priority: 0,
  },
  rank_up: {
    icon: Sparkles,
    accent: ACCOUNT_ACCENT,
    bgAccent: ACCOUNT_BG,
    category: "account",
    priority: 1,
  },
  streak_milestone: {
    icon: Flame,
    accent: ACCOUNT_ACCENT,
    bgAccent: ACCOUNT_BG,
    category: "account",
    priority: 0,
  },
  credits_low: {
    icon: ShieldAlert,
    accent: ACCOUNT_ACCENT,
    bgAccent: ACCOUNT_BG,
    category: "account",
    priority: 0,
  },
  credits_granted: {
    icon: Wallet,
    accent: ACCOUNT_ACCENT,
    bgAccent: ACCOUNT_BG,
    category: "account",
    priority: 1,
  },
  badge_awarded: {
    icon: Award,
    accent: ACCOUNT_ACCENT,
    bgAccent: ACCOUNT_BG,
    category: "account",
    priority: 1,
  },
  announcement: {
    icon: Megaphone,
    accent: SYSTEM_ACCENT,
    bgAccent: SYSTEM_BG,
    category: "system",
    priority: 1,
  },
};

const FALLBACK: KindMeta = {
  icon: Bell,
  accent: NEUTRAL_ACCENT,
  bgAccent: NEUTRAL_BG,
  category: "system",
  priority: 0,
};

/**
 * Resolve metadata for a kind string. Tolerant of forward-compat values
 * the server might add before this client bundles — falls back to a
 * neutral bell icon rather than throwing.
 */
export function getKindMeta(kind: string): KindMeta {
  return (NOTIFICATION_REGISTRY as Record<string, KindMeta>)[kind] ?? FALLBACK;
}

/**
 * Should this kind auto-toast when it arrives in-session via Realtime?
 * Returns true only for "high signal" kinds — settlement, payouts,
 * promotions, broadcasts. Everything else lands silently in the bell.
 */
export function shouldAutoToast(kind: string): boolean {
  return getKindMeta(kind).priority === 1;
}
