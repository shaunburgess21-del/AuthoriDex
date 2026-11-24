/**
 * XP and Vox numbers the help chat quotes. Live values come from the
 * xp_actions / credit_actions tables (see ./live-rates); the fallback below
 * mirrors server/scripts/seed-gamification.ts and shared/credit-config.ts
 * and is only used when that read fails.
 */
import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "@shared/credit-config";
import { RANKS } from "@shared/rank-config";
import {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
  streakMilestoneActionKey,
} from "@shared/streak-config";
import { ANON_VOTE_BUDGET } from "../lib/rankingConfig";

export interface HelpXpRate {
  key: string;
  label: string;
  xp: number;
  dailyCap: number | null;
  description: string | null;
}

export interface HelpVoxRate {
  key: string;
  label: string;
  vox: number;
  dailyCap: number | null;
  category: string;
}

export interface HelpRates {
  xp: HelpXpRate[];
  vox: HelpVoxRate[];
  signupGrant: number;
  anonVoteBudget: number;
}

const HIDDEN_XP_KEYS = new Set(["legacy_migration", "admin_adjustment"]);
const HIDDEN_VOX_CATEGORIES = new Set(["SPECIAL"]);

const FALLBACK_XP: HelpXpRate[] = [
  { key: "vote_sentiment", label: "Sentiment Vote", xp: 20, dailyCap: 20, description: "Agree, Neutral, or Disagree on a sentiment poll" },
  { key: "vote_face_off", label: "Matchup Vote", xp: 20, dailyCap: 20, description: "Vote in a Matchup" },
  { key: "vote_induction", label: "Induction Vote", xp: 20, dailyCap: 10, description: "Vote on candidate for main leaderboard" },
  { key: "vote_curation", label: "Image Curation Vote", xp: 20, dailyCap: 20, description: "Choose which profile photo should be featured" },
  { key: "vote_opinion", label: "Opinion Poll Vote", xp: 20, dailyCap: 20, description: "Vote on an opinion poll" },
  { key: "post_insight", label: "Post Insight", xp: 50, dailyCap: 5, description: "Post a community insight" },
  { key: "post_comment", label: "Post Comment", xp: 15, dailyCap: 10, description: "Comment on any discussion thread (min 20 chars, cap 10/day)" },
  { key: "submit_suggestion", label: "Submit Suggestion", xp: 5, dailyCap: 3, description: "Earn XP for submitting content suggestions for admin review" },
  { key: "suggestion_approved", label: "Suggestion Approved", xp: 50, dailyCap: null, description: "Bonus XP when your suggested content is approved and goes live" },
  { key: "market_suggestion_approved", label: "Market Suggestion Approved", xp: 100, dailyCap: null, description: "Bonus when a suggested world/open market is approved and published" },
  { key: "upvote_insight", label: "Upvote a Post", xp: 5, dailyCap: 10, description: "Upvote an insight or comment" },
  { key: "insight_upvoted", label: "Your Post Gets Upvoted", xp: 20, dailyCap: 10, description: "Earned when your insight or comment receives an upvote from another VoxMaxxer" },
  { key: "place_prediction", label: "Place Prediction", xp: 20, dailyCap: 10, description: "Place a prediction on a market" },
  { key: "prediction_win", label: "Prediction Win", xp: 50, dailyCap: null, description: "Bonus XP when a prediction settles in your favour (once per market)" },
  { key: "profile_avatar", label: "Profile Photo Added", xp: 25, dailyCap: null, description: "One-time XP for uploading a profile photo" },
  { key: "profile_bio", label: "Profile Name & Bio", xp: 25, dailyCap: null, description: "One-time XP for completing your display name and bio" },
  { key: "community_member", label: "Community Member", xp: 25, dailyCap: null, description: "One-time XP for adding age, gender, and country of residence" },
  { key: "profile_demographics", label: "Profile Demographics", xp: 100, dailyCap: null, description: "One-time XP for completing all demographic fields" },
  { key: "daily_login", label: "Daily Login", xp: 10, dailyCap: 1, description: "Log in daily to earn streak bonus" },
  { key: "streak_bonus", label: "Streak Bonus", xp: 25, dailyCap: 1, description: "Bonus XP for maintaining a multi-day streak" },
  ...STREAK_MILESTONES.map((day) => ({
    key: streakMilestoneActionKey(day),
    label: `Streak Milestone — Day ${day}`,
    xp: STREAK_MILESTONE_XP[day],
    dailyCap: null,
    description: `One-time bonus for reaching a ${day}-day login streak`,
  })),
];

const FALLBACK_VOX: HelpVoxRate[] = CREDIT_ACTIONS.filter((a) => a.isActive).map((a) => ({
  key: a.key,
  label: a.label,
  vox: a.proposedCredits,
  dailyCap: a.dailyCap,
  category: a.category,
}));

export const FALLBACK_HELP_RATES: HelpRates = {
  xp: FALLBACK_XP,
  vox: FALLBACK_VOX,
  signupGrant: SIGNUP_CREDIT_GRANT,
  anonVoteBudget: ANON_VOTE_BUDGET,
};

const XP_ORDER = new Map(FALLBACK_XP.map((row, index) => [row.key, index]));
const VOX_ORDER = new Map(CREDIT_ACTIONS.map((row, index) => [row.key, index]));

/** Stable order so the prompt text (and OpenAI's prompt cache) only changes when a value does. */
function byKnownOrder<T extends { key: string }>(rows: T[], order: Map<string, number>): T[] {
  return [...rows].sort((a, b) => {
    const ai = order.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bi = order.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    return ai !== bi ? ai - bi : a.key.localeCompare(b.key);
  });
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function perDay(cap: number): string {
  return cap === 1 ? ", once a day" : `, up to ${cap} times a day`;
}

function xpFrequency(row: HelpXpRate): string {
  if (row.dailyCap != null && row.dailyCap > 0) return perDay(row.dailyCap);
  if (row.key.startsWith("streak_milestone_") || row.key.startsWith("profile_") || row.key === "community_member") {
    return ", once";
  }
  return "";
}

const VOX_NOTES: Record<string, string> = {
  vote_any: "for any vote, on any vote surface",
  referral_completed: "paid to you when someone you referred completes their first meaningful action. Friends past that day's limit stay queued and pay on a later day",
  referral_signup_bonus: "for a new member who signed up through a referral link, on top of the signup grant",
  share_click: "when a share link you sent gets a confirmed click",
};

function voxFrequency(row: HelpVoxRate): string {
  if (row.dailyCap != null && row.dailyCap > 0) return perDay(row.dailyCap);
  if (row.category === "STREAK" || row.category === "PROFILE") return ", once";
  return "";
}

/** The rates section appended to the help prompt. */
export function renderRatesArticle(rates: HelpRates): string {
  const xpLines = byKnownOrder(
    rates.xp.filter((row) => !HIDDEN_XP_KEYS.has(row.key) && row.xp > 0),
    XP_ORDER,
  ).map((row) => {
    const description = row.description?.trim();
    return `- ${row.label}: ${formatCount(row.xp)} XP${xpFrequency(row)}.${description ? ` ${description}.` : ""}`;
  });

  const voxLines = byKnownOrder(
    rates.vox.filter((row) => !HIDDEN_VOX_CATEGORIES.has(row.category) && row.vox > 0),
    VOX_ORDER,
  ).map((row) => {
    const note = VOX_NOTES[row.key];
    return `- ${row.label}: ${formatCount(row.vox)} Vox${voxFrequency(row)}${note ? ` (${note})` : ""}.`;
  });

  const rankLines = RANKS.map((rank) => {
    const range = rank.maxXp == null
      ? `${formatCount(rank.minXp)} XP and up`
      : `${formatCount(rank.minXp)} to ${formatCount(rank.maxXp)} XP`;
    return `- ${rank.name} (tier ${rank.tier}): ${range}. Earn rate ${rank.earnMultiplier.toFixed(2)}×. Curatorial vote weight ${rank.curatorialWeight.toFixed(2)}×. ${rank.description}`;
  });

  return `## Current numbers
These are the live values the site uses right now. Quote them exactly. Your rank multiplies XP and Vox payouts by its earn rate.

Signup grant: ${formatCount(rates.signupGrant)} Vox, once, when an account is created.
Without an account, a visitor can cast up to ${rates.anonVoteBudget} votes before being asked to sign in. Those votes do not earn XP or Vox.

XP:
${xpLines.join("\n")}

Vox:
${voxLines.join("\n")}

User ranks, lowest to highest:
${rankLines.join("\n")}`;
}
