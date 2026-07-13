/**
 * Shared types for the P0 content-moderation pipeline.
 *
 * Decisions:
 *   - allow      — clean; no queue row needed
 *   - review     — ambiguous; content stays visible, queued for humans
 *   - auto_hide  — high-confidence abuse; hide from public UI + queue
 */

export type ModerationDecision = "allow" | "review" | "auto_hide";

export type ModerationContentType =
  | "comment"
  | "profile_bio"
  | "profile_username"
  | "opinion_option_suggestion"
  | "suggestion_text";

/** Lifecycle of a moderation_events row. */
export type ModerationEventStatus =
  | "pending"
  | "approved"
  | "removed"
  | "dismissed";

export interface ModerationCategoryScores {
  [category: string]: number;
}

export interface TextModerationResult {
  decision: ModerationDecision;
  flagged: boolean;
  /** Omni category → score map (0–1). */
  scores: ModerationCategoryScores;
  /** Categories that crossed our auto-hide / review thresholds. */
  matchedCategories: string[];
  /** True when we failed open (API error / kill switch off / no key). */
  failOpen: boolean;
  provider: "openai_omni" | "local_blocklist" | "disabled" | "error";
  /** Truncated input echoed for audit (never store full PII dumps elsewhere). */
  sampleText: string;
}

export interface ApplyModerationInput {
  contentType: ModerationContentType;
  contentId: string;
  authorId: string | null;
  text: string;
  /** Extra context stored in moderation_events.metadata. */
  metadata?: Record<string, unknown>;
}
