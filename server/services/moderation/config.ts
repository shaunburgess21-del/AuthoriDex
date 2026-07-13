/**
 * Env + threshold helpers for text moderation.
 *
 * Tuned for an X-like posture: heated debate / insults stay up; only clear
 * threats, hate, sexual, and self-harm intent auto-hide. Kill switch uses the
 * same literal-true pattern as WORLD_MARKETS_LLM_ENABLED.
 */

function envFlag(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function envFloat(value: string | undefined, fallback: number): number {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Master kill switch. Off by default until explicitly enabled in env. */
export const TEXT_MODERATION_ENABLED = envFlag(process.env.TEXT_MODERATION_ENABLED);

/**
 * Score ≥ this → auto_hide (when category is in AUTO_HIDE_CATEGORIES).
 * Omni scores are calibrated probabilities ~0–1. Default 0.92 = X-like.
 */
export const MODERATION_AUTO_HIDE_THRESHOLD = envFloat(
  process.env.MODERATION_AUTO_HIDE_THRESHOLD,
  0.92,
);

/**
 * Score ≥ this (but below auto-hide) → review queue while staying visible.
 * Default 0.78 keeps plain insults out of the queue.
 */
export const MODERATION_REVIEW_THRESHOLD = envFloat(
  process.env.MODERATION_REVIEW_THRESHOLD,
  0.78,
);

/**
 * Categories that can trigger auto_hide when above AUTO_HIDE_THRESHOLD.
 * Deliberately excludes plain `harassment` / `violence` so heated debate passes.
 */
export const AUTO_HIDE_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "hate",
  "hate/threatening",
  "harassment/threatening",
  "violence/graphic",
  "self-harm/intent",
  "self-harm/instructions",
] as const;

/**
 * Categories that can trigger review when above REVIEW_THRESHOLD.
 * Same set as auto-hide — we do not queue plain harassment/violence.
 */
export const REVIEW_CATEGORIES = [...AUTO_HIDE_CATEGORIES] as const;
