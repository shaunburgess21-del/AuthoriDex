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
  // Smoked-chrome / cool graphite — matches the Daily Movers pulse-card-blue
  // neutral silver palette in client/src/index.css.
  { id: "xp", label: "XP", icon: Zap, accent: "#94A3B8" },
  // Theme blue — same as the Trending leaderboard + VoxPulse widget.
  { id: "ranks", label: "Ranks", icon: Crown, accent: "#3C83F6" },
  // Amber/gold — currency feel; mirrors the "Impact" accent on /me/votes.
  { id: "credits", label: "Credits", icon: Coins, accent: "#F59E0B" },
  // Emerald — fresh achievement tone, distinct from amber Credits / gold ranks.
  { id: "badges", label: "Badges", icon: ShieldCheck, accent: "#10B981" },
  // Cyan — site-wide Vote accent.
  { id: "vote", label: "Vote", icon: Vote, accent: "#22D3EE" },
  // Violet — site-wide Predict accent.
  { id: "predict", label: "Predict", icon: TrendingUp, accent: "#8B5CF6" },
];

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
  { actionKey: "vote_sentiment", displayName: "Sentiment Vote", xpValue: 25, dailyCap: 20, description: "Vote on celebrity sentiment (1-10 scale)", category: "Voting" },
  { actionKey: "vote_face_off", displayName: "Matchup Vote", xpValue: 15, dailyCap: 25, description: "Vote in a Matchup", category: "Voting" },
  { actionKey: "vote_induction", displayName: "Induction Vote", xpValue: 30, dailyCap: 10, description: "Vote on candidate for main leaderboard", category: "Voting" },
  { actionKey: "vote_curation", displayName: "Image Curation Vote", xpValue: 20, dailyCap: 30, description: "Vote on profile images (hot-or-not)", category: "Voting" },
  { actionKey: "vote_opinion", displayName: "Opinion Poll Vote", xpValue: 15, dailyCap: 20, description: "Vote on an opinion poll", category: "Voting" },

  { actionKey: "post_insight", displayName: "Post Insight", xpValue: 50, dailyCap: 5, description: "Post a community insight", category: "Content" },
  { actionKey: "post_comment", displayName: "Post Comment", xpValue: 15, dailyCap: 10, description: "Comment on an insight (min 20 chars, not on own insight)", category: "Content" },
  { actionKey: "submit_suggestion", displayName: "Submit Suggestion", xpValue: 5, dailyCap: 3, description: "Submit content suggestions for admin review", category: "Content" },
  { actionKey: "suggestion_approved", displayName: "Suggestion Approved", xpValue: 50, dailyCap: null, description: "Bonus when a suggestion is approved and goes live", category: "Content" },

  { actionKey: "upvote_insight", displayName: "Upvote Insight", xpValue: 5, dailyCap: 50, description: "Upvote a community insight or comment", category: "Engagement" },
  { actionKey: "downvote_insight", displayName: "Downvote Insight", xpValue: 5, dailyCap: 50, description: "Downvote a community insight or comment", category: "Engagement" },

  { actionKey: "place_prediction", displayName: "Place Prediction", xpValue: 20, dailyCap: 10, description: "Place a prediction on a market", category: "Prediction" },
  { actionKey: "prediction_win", displayName: "Prediction Win", xpValue: 100, dailyCap: null, description: "Bonus XP when a prediction settles in your favour", category: "Prediction" },

  { actionKey: "daily_login", displayName: "Daily Login", xpValue: 10, dailyCap: 1, description: "Log in to keep your streak alive", category: "Streak" },
  { actionKey: "streak_bonus", displayName: "Streak Bonus", xpValue: 25, dailyCap: 1, description: "Bonus XP for maintaining a multi-day streak", category: "Streak" },

  { actionKey: "legacy_migration", displayName: "Legacy Migration", xpValue: 0, dailyCap: null, description: "One-time XP carried over from the legacy system", category: "Special" },
  { actionKey: "admin_adjustment", displayName: "Admin Adjustment", xpValue: 0, dailyCap: null, description: "Manual XP adjustment by an admin", category: "Special" },
];

export interface RankRow {
  name: string;
  tier: number;
  minXp: number;
  /** null = open-ended top tier. */
  maxXp: number | null;
  /** Stored on the rank row but currently unused by vote weighting. */
  voteMultiplier: number;
  color: string;
  description: string;
}

/** Mirror of server/scripts/seed-gamification.ts → seedRanks. */
export const RANKS: RankRow[] = [
  { name: "Citizen", tier: 1, minXp: 0, maxXp: 499, voteMultiplier: 1.0, color: "#6B7280", description: "Welcome to VoxDex. Every VoxMaxxer starts here." },
  { name: "Aspirant", tier: 2, minXp: 500, maxXp: 1999, voteMultiplier: 1.0, color: "#10B981", description: "You're finding your voice. Keep VoxMaxxing." },
  { name: "Insider", tier: 3, minXp: 2000, maxXp: 4999, voteMultiplier: 1.25, color: "#3B82F6", description: "You know how VoxDex works. Your perspective matters." },
  { name: "Analyst", tier: 4, minXp: 5000, maxXp: 9999, voteMultiplier: 1.5, color: "#8B5CF6", description: "A sharp read on the room. Your votes carry weight." },
  { name: "Expert", tier: 5, minXp: 10000, maxXp: 24999, voteMultiplier: 1.75, color: "#F59E0B", description: "Deep knowledge, consistent takes. Others follow your lead." },
  { name: "Maven", tier: 6, minXp: 25000, maxXp: 49999, voteMultiplier: 2.0, color: "#EF4444", description: "Elite tier. Your predictions and calls set the pace." },
  { name: "Hall of Famer", tier: 7, minXp: 50000, maxXp: 149999, voteMultiplier: 2.5, color: "#FFD700", description: "Legendary status. A veteran of the VoxDex arena." },
  { name: "VoxMax Legend", tier: 8, minXp: 150000, maxXp: null, voteMultiplier: 3.0, color: "#E5E4E2", description: "The rarest status on VoxDex — reserved for those who reach the summit." },
];

/**
 * Capability gates resolved by server/services/gamification-utils.ts →
 * canAccessCapability. Tier 2 (Aspirant, 500 XP) is the universal unlock
 * point for higher-trust actions today.
 */
export interface CapabilityRow {
  capability: string;
  minTier: number;
  description: string;
}

export const CAPABILITY_GATES: CapabilityRow[] = [
  { capability: "Vote on inductions", minTier: 2, description: "Decide who joins the main leaderboard." },
  { capability: "Vote on profile images (curation)", minTier: 2, description: "Hot-or-not voting on candidate images." },
  { capability: "Post insights", minTier: 2, description: "Create top-level community insights on cards." },
  { capability: "Comment on insights", minTier: 2, description: "Reply to insights and other comments." },
];

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
  { surface: "Place a prediction (any market)", where: "/predict and per-market detail pages", xpActionKey: "place_prediction", notes: "Costs Credits (the stake)." },
  { surface: "Prediction settles in your favour", where: "Awarded automatically by the market resolver", xpActionKey: "prediction_win", notes: "AMM payout returns Credits to your balance." },
  { surface: "Suggest a world / open market", where: "/predict → suggest, then admin review", xpActionKey: "submit_suggestion" },
  { surface: "Your market suggestion is approved", where: "Bonus when admins publish your suggested market", xpActionKey: "suggestion_approved" },
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
