import type { InsightsSource } from "./filters";
import type { InsightsPrimaryDriver } from "./types";

/** Minimum approval votes to appear on the Approval × Fame quadrant. */
export const QUADRANT_MIN_VOTES = 20;

export const INSIGHTS_SOURCE_LABELS: Record<InsightsSource, string> = {
  news_momentum: "News momentum",
  wiki_momentum: "Wiki momentum",
  fame: "Movers",
  news: "News (24h)",
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
