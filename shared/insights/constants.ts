import type { InsightsSource } from "./filters";
import type { InsightsPrimaryDriver } from "./types";

/** Minimum approval votes to appear on the Approval × Fame quadrant. */
export const QUADRANT_MIN_VOTES = 20;

export const INSIGHTS_SOURCE_LABELS: Record<InsightsSource, string> = {
  news_momentum: "News momentum",
  wiki_momentum: "Wiki momentum",
  velocity: "Velocity",
  mass: "Mass",
  fame: "Fame Index",
  news: "Press (24h)",
  wiki: "Wikipedia",
  trends: "Google Trends",
};

export const INSIGHTS_DRIVER_LABELS: Record<InsightsPrimaryDriver, string> = {
  NEWS: "Press-led",
  WIKI: "Wiki-led",
  TRENDS: "Search-led",
  VELOCITY: "Velocity-led",
  MASS: "Mass-led",
  MIXED: "Mixed signals",
};

export const INSIGHTS_DIVERGENCE_LABELS: Record<string, string> = {
  rising_disliked: "Rising but Disliked",
  underrated_gaining: "Underrated & Gaining",
  overrated_cooling: "Overrated & Cooling",
  consensus: "Consensus Sweet Spot",
};
