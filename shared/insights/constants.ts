import type { InsightsSource, InsightsTab } from "./filters";
import type { InsightsPrimaryDriver } from "./types";

/** Tab bar underline + section card border styling (single source of truth). */
export const INSIGHTS_TAB_ACCENTS = {
  today: { hex: "#3B82F6", cardClass: "pulse-card-voxdex" },
  rankings: { hex: "#94A3B8", cardClass: "pulse-card-blue" },
  discover: { hex: "#F97316", cardClass: "pulse-card-orange" },
  vote: { hex: "#22D3EE", cardClass: "pulse-card-cyan" },
  predict: { hex: "#8B5CF6", cardClass: "pulse-card-purple" },
  crowd: { hex: "#22D3EE", cardClass: "pulse-card-cyan" },
} as const satisfies Record<InsightsTab, { hex: string; cardClass: string }>;

export function getInsightsTabCardClass(tab: InsightsTab): string {
  return INSIGHTS_TAB_ACCENTS[tab].cardClass;
}

export function getInsightsTabAccentHex(tab: InsightsTab): string {
  return INSIGHTS_TAB_ACCENTS[tab].hex;
}

/** Minimum approval votes to appear on the Approval × Fame quadrant. */
export const QUADRANT_MIN_VOTES = 20;

export const INSIGHTS_SOURCE_LABELS: Record<InsightsSource, string> = {
  news_momentum: "News momentum",
  wiki_momentum: "Wiki momentum",
  fame: "Movers",
  news: "News",
  wiki: "Wikipedia",
  search_volume: "Search interest",
};

/** User-facing driver labels (aligned with profile Attention Signals). */
export const INSIGHTS_DRIVER_LABELS: Record<InsightsPrimaryDriver, string> = {
  NEWS: "News Activity",
  WIKI: "Wikipedia Activity",
  SEARCH: "Search Activity",
  MIXED: "Mixed signals",
};

/** Today-tab Attention mix — off until we have more velocity drivers (e.g. X mentions). */
export const INSIGHTS_ATTENTION_MIX_ENABLED = false;

/** One-line explainer for the Today tab Attention mix legend. */
export const INSIGHTS_DRIVER_LEGEND: Record<InsightsPrimaryDriver, string> = {
  NEWS: "recent news headlines",
  WIKI: "Wikipedia page traffic",
  SEARCH: "Google search interest",
  MIXED: "more than one signal at once",
};

export const INSIGHTS_DIVERGENCE_LABELS: Record<string, string> = {
  rising_disliked: "Rising but Disliked",
  underrated_gaining: "Underrated & Gaining",
  overrated_cooling: "Overrated & Cooling",
  consensus: "Consensus Sweet Spot",
};
