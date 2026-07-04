/**
 * Single source of truth for the /how-it-works knowledge base page.
 *
 * Numbers are mirrored from server/scripts/seed-gamification.ts. When you
 * change those, update this file too — or wire this off the /api/ranks +
 * /api/xp-actions endpoints in a later pass. For now this is intentionally
 * static so the page renders fully on first paint without an extra fetch.
 */

import type { ComponentType, SVGProps } from "react";
import {
  Zap,
  Crown,
  Coins,
  ShieldCheck,
  Vote,
  TrendingUp,
} from "lucide-react";

export type KnowledgeTabId =
  | "xp"
  | "ranks"
  | "credits"
  | "badges"
  | "vote"
  | "predict";

export interface KnowledgeTab {
  id: KnowledgeTabId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Hex used by ProfileTabs for the active underline + icon tint. */
  accent: string;
}

export const KNOWLEDGE_TABS: KnowledgeTab[] = [
  // Bright peak of Daily Movers top bar — see `.pulse-card-blue::before` in
  // client/src/index.css (white ~70% at center). How It Works uses theme-aware
  // Tailwind for the XP tab/section so light mode stays readable.
  { id: "xp", label: "XP", icon: Zap, accent: "#FFFFFF" },
  // Theme blue — same as the Trending leaderboard + VoxPulse widget.
  { id: "ranks", label: "Ranks", icon: Crown, accent: "#3C83F6" },
  // Amber/gold — currency feel; mirrors the "Impact" accent on /me/votes.
  { id: "credits", label: "Vox", icon: Coins, accent: "#F59E0B" },
  // Emerald — fresh achievement tone, distinct from amber Vox / gold ranks.
  { id: "badges", label: "Badges", icon: ShieldCheck, accent: "#10B981" },
  // Cyan — site-wide Vote accent.
  { id: "vote", label: "Vote", icon: Vote, accent: "#22D3EE" },
  // Violet — site-wide Predict accent.
  { id: "predict", label: "Predict", icon: TrendingUp, accent: "#8B5CF6" },
];

/** Tab order for the How It Works bar and mobile swipe navigation. */
export const KNOWLEDGE_NAV_TAB_ORDER: KnowledgeTabId[] = KNOWLEDGE_TABS.map((t) => t.id);

/**
 * Maps each knowledge tab to the matching `.pulse-card-*` glow skin defined in
 * client/src/index.css (the same premium glow used on the Insights page). Five
 * of the six map onto existing variants; Vox uses the amber variant added for
 * the currency accent. These literals live under client/src so Tailwind's
 * content scan retains the CSS in production.
 */
export const KNOWLEDGE_TAB_GLOW: Record<KnowledgeTabId, string> = {
  xp: "pulse-card-blue",
  ranks: "pulse-card-voxdex",
  credits: "pulse-card-amber",
  badges: "pulse-card-green",
  vote: "pulse-card-cyan",
  predict: "pulse-card-purple",
};

export function glowClassFor(id: KnowledgeTabId): string {
  return KNOWLEDGE_TAB_GLOW[id];
}

export interface XpActionRow {
  actionKey: string;
  displayName: string;
  xpValue: number;
  /** null = no daily cap. */
  dailyCap: number | null;
  description: string;
  category:
    | "Voting"
    | "Content"
    | "Engagement"
    | "Prediction"
    | "Streak"
    | "Special";
}

/** Mirror of server/scripts/seed-gamification.ts → seedXpActions. */
export const XP_ACTIONS: XpActionRow[] = [
  { actionKey: "vote_sentiment", displayName: "Sentiment Vote", xpValue: 20, dailyCap: 20, description: "Vote on celebrity sentiment (1-10 scale)", category: "Voting" },
  { actionKey: "vote_face_off", displayName: "Matchup Vote", xpValue: 20, dailyCap: 20, description: "Vote in a Matchup", category: "Voting" },
  { actionKey: "vote_induction", displayName: "Induction Vote", xpValue: 20, dailyCap: 10, description: "Vote on candidate for main leaderboard", category: "Voting" },
  { actionKey: "vote_curation", displayName: "Image Curation Vote", xpValue: 20, dailyCap: 20, description: "Vote on whether a profile image should be featured", category: "Voting" },
  { actionKey: "vote_opinion", displayName: "Opinion Poll Vote", xpValue: 20, dailyCap: 20, description: "Vote on an opinion poll", category: "Voting" },

  { actionKey: "post_insight", displayName: "Post Insight", xpValue: 50, dailyCap: 5, description: "Post a community insight", category: "Content" },
  { actionKey: "post_comment", displayName: "Post Comment", xpValue: 15, dailyCap: 10, description: "Comment on any discussion thread (min 20 chars)", category: "Content" },
  { actionKey: "submit_suggestion", displayName: "Submit Suggestion", xpValue: 5, dailyCap: 3, description: "Submit content suggestions for admin review", category: "Content" },
  { actionKey: "suggestion_approved", displayName: "Suggestion Approved", xpValue: 50, dailyCap: null, description: "Bonus when a suggestion is approved and goes live", category: "Content" },
  { actionKey: "market_suggestion_approved", displayName: "Market Suggestion Approved", xpValue: 100, dailyCap: null, description: "Bonus when a suggested world/open market is approved and published", category: "Content" },

  { actionKey: "upvote_insight", displayName: "Upvote a Post", xpValue: 5, dailyCap: 10, description: "Upvote an insight or comment", category: "Engagement" },
  { actionKey: "insight_upvoted", displayName: "Your Post Gets Upvoted", xpValue: 20, dailyCap: 10, description: "Earned when your insight or comment receives an upvote from another VoxMaxxer", category: "Engagement" },

  { actionKey: "place_prediction", displayName: "Place Prediction", xpValue: 20, dailyCap: 10, description: "Place a prediction on a market", category: "Prediction" },
  { actionKey: "prediction_win", displayName: "Prediction Win", xpValue: 100, dailyCap: null, description: "Bonus XP when a prediction settles in your favour", category: "Prediction" },

  { actionKey: "community_member", displayName: "Community Member", xpValue: 25, dailyCap: null, description: "One-time XP for adding age, gender, and country of residence", category: "Special" },

  { actionKey: "daily_login", displayName: "Daily Login", xpValue: 10, dailyCap: 1, description: "Log in to keep your streak alive", category: "Streak" },
  { actionKey: "streak_bonus", displayName: "Streak Bonus", xpValue: 25, dailyCap: 1, description: "Bonus XP for maintaining a multi-day streak", category: "Streak" },

  // Special category is admin-only and intentionally hidden from
  // HowItWorksPage (see HowItWorksPage.tsx XpSection's category list).
  // Kept here for the admin portal / XP audit views which reuse this
  // catalogue.
  { actionKey: "legacy_migration", displayName: "Legacy Migration", xpValue: 0, dailyCap: null, description: "One-time XP carried over from the legacy system", category: "Special" },
  { actionKey: "admin_adjustment", displayName: "Admin Adjustment", xpValue: 0, dailyCap: null, description: "Manual XP adjustment by an admin", category: "Special" },
];

/**
 * Rank ladder + capability gate matrix. Both are owned by
 * `shared/rank-config.ts` so the server seed, the client UI, and the
 * notifications cron cannot drift apart. We re-export the shared
 * shapes under the legacy names (`RankRow`, `CapabilityRow`) so
 * existing call sites keep compiling.
 */
export {
  RANKS,
  CAPABILITY_GATES,
  type RankConfig as RankRow,
  type CapabilityGate as CapabilityRow,
} from "@shared/rank-config";

import { RANKS as RANKS_INTERNAL } from "@shared/rank-config";
import {
  Award,
  BarChart,
  Crown as CrownIcon,
  Eye,
  Shield,
  Sparkles,
  Star,
  TrendingUp as TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Map the string `icon` field on shared/rank-config to a real Lucide
 * component. Lives on the client because the shared module is
 * runtime-agnostic and shouldn't pull in `lucide-react`. Extend this
 * map when adding a new tier with a new icon.
 */
const RANK_ICON_MAP: Record<string, LucideIcon> = {
  user: Shield,
  "trending-up": TrendingUpIcon,
  eye: Eye,
  "bar-chart": BarChart,
  award: Award,
  star: Star,
  crown: CrownIcon,
  sparkles: Sparkles,
};

/**
 * UI-flavoured wrapper around getRankByName. Returns the canonical
 * rank row plus a resolved Lucide icon component, with a Citizen
 * fallback so legacy `profiles.rank` values that pre-date a rebalance
 * still render something instead of nothing.
 */
export function getRankConfig(name: string | null | undefined): {
  name: string;
  tier: number;
  color: string;
  icon: LucideIcon;
  description: string;
} {
  const found =
    RANKS_INTERNAL.find((r) => r.name === name) ?? RANKS_INTERNAL[0];
  return {
    name: found.name,
    tier: found.tier,
    color: found.color,
    icon: RANK_ICON_MAP[found.icon] ?? Shield,
    description: found.description,
  };
}

/**
 * Vote surfaces that exist on the site today, with the XP action key they
 * award through (cross-references XP_ACTIONS).
 */
export interface VoteSurfaceRow {
  surface: string;
  where: string;
  xpActionKey: string;
}

export const VOTE_SURFACES: VoteSurfaceRow[] = [
  { surface: "Sentiment vote (1–10)", where: "Celebrity profile → Vote tab", xpActionKey: "vote_sentiment" },
  { surface: "Matchup vote (head-to-head)", where: "/vote → Matchups", xpActionKey: "vote_face_off" },
  { surface: "Induction vote", where: "/vote/induction (candidates for the main leaderboard)", xpActionKey: "vote_induction" },
  { surface: "Image curation (hot-or-not)", where: "Celebrity profile → Vote tab → image votes", xpActionKey: "vote_curation" },
  { surface: "Opinion poll vote", where: "/vote → Opinion Polls", xpActionKey: "vote_opinion" },
];

/** Predict surfaces and the XP action keys they award through. */
export interface PredictSurfaceRow {
  surface: string;
  where: string;
  xpActionKey: string;
  notes?: string;
}

export const PREDICT_SURFACES: PredictSurfaceRow[] = [
  { surface: "Place a prediction (any market)", where: "/predict and per-market detail pages", xpActionKey: "place_prediction", notes: "Costs Vox to stake" },
  { surface: "Prediction settles in your favour", where: "Awarded automatically by the market resolver", xpActionKey: "prediction_win", notes: "Winning stake + share of pool returned to balance" },
  { surface: "Suggest a world / open market", where: "/predict → suggest, then admin review", xpActionKey: "submit_suggestion", notes: "Admin-reviewed before publish" },
  { surface: "Your market suggestion is approved", where: "Bonus when admins publish your suggested market", xpActionKey: "market_suggestion_approved", notes: "+Ꝟ100 paid alongside" },
];

/**
 * Proposed credit-earn rates for the upcoming "earn credits via actions"
 * pass. Values are intentionally TBD here — the knowledge base page surfaces
 * them as a roadmap, not a contract.
 */
export interface ProposedCreditEarnRow {
  action: string;
  proposedCredits: string;
  notes: string;
}

export const PROPOSED_CREDIT_EARNS: ProposedCreditEarnRow[] = [
  { action: "Vote on a card (any vote surface)", proposedCredits: "TBD — small", notes: "Daily cap to prevent farming." },
  { action: "Place a prediction", proposedCredits: "TBD — small", notes: "Encourages active participation, not just stake size." },
  { action: "Comment on a card or insight", proposedCredits: "TBD — small", notes: "Min length + per-thread cap to discourage spam." },
  { action: "Reply to a comment", proposedCredits: "TBD — micro", notes: "Lower than top-level comment to discourage thread padding." },
  { action: "Vote suggestion approved", proposedCredits: "TBD — meaningful", notes: "Approval-gated so only signal-quality submissions earn." },
  { action: "World-market prediction suggestion approved", proposedCredits: "TBD — meaningful", notes: "Approval-gated; world markets carry the most editorial weight." },
];

/** Proposed badges taxonomy. Not yet implemented in the DB. */
export interface ProposedBadgeRow {
  category: "Action" | "Milestone" | "Special / Event";
  name: string;
  trigger: string;
  rarity: "Common" | "Rare" | "Epic" | "Legendary";
}

export const PROPOSED_BADGES: ProposedBadgeRow[] = [
  { category: "Action", name: "Voter I / II / III", trigger: "100 / 1,000 / 10,000 lifetime votes", rarity: "Common" },
  { category: "Action", name: "Forecaster I / II / III", trigger: "50 / 500 / 5,000 predictions placed", rarity: "Common" },
  { category: "Action", name: "Commentator I / II / III", trigger: "25 / 250 / 2,500 comments posted", rarity: "Common" },
  { category: "Action", name: "Curator", trigger: "500 image-curation votes", rarity: "Rare" },
  { category: "Milestone", name: "First Vote", trigger: "Cast your first vote", rarity: "Common" },
  { category: "Milestone", name: "First Win", trigger: "Win your first prediction", rarity: "Common" },
  { category: "Milestone", name: "First Approved Suggestion", trigger: "Your first content suggestion goes live", rarity: "Rare" },
  { category: "Milestone", name: "Streak Keeper", trigger: "7 / 30 / 100-day login streaks", rarity: "Rare" },
  { category: "Milestone", name: "Hall Inductee", trigger: "Reach Hall of Famer rank", rarity: "Epic" },
  { category: "Special / Event", name: "Founder", trigger: "Joined VoxDex during launch era", rarity: "Legendary" },
  { category: "Special / Event", name: "Seasonal Event", trigger: "Participate in a featured seasonal event", rarity: "Rare" },
  { category: "Special / Event", name: "Admin Awarded", trigger: "Recognised by the VoxDex team for outstanding contribution", rarity: "Epic" },
];
