import { z } from "zod";
import { OPINION_POLL_MIN_OPTIONS, OPINION_POLL_MAX_OPTIONS } from "./constants";

export const SUGGESTION_TYPES = [
  "matchup",
  "sentiment_poll",
  "opinion_poll",
  "induction",
  "profile_image",
  "open_market",
] as const;

export type SuggestionType = (typeof SUGGESTION_TYPES)[number];

// ---- Per-type payload schemas (user-fillable fields only) ----
// Admin-only fields excluded: slug, featured, visibility, seed*, relatedPersonIds,
// resolveMethod, resolutionCriteria, underlying/metric/strike/unit, closeAt,
// inactiveMessage, wikiSlug, imageSlug, source.

export const matchupSuggestionSchema = z.object({
  title: z.string().min(1).max(60),
  category: z.string().min(1),
  optionAText: z.string().min(1),
  optionBText: z.string().min(1),
  personAId: z.string().optional(),
  personBId: z.string().optional(),
  optionAImage: z.string().url().optional(),
  optionBImage: z.string().url().optional(),
  description: z.string().max(200).optional(),
  promptText: z.string().max(200).optional(),
});

export const sentimentPollSuggestionSchema = z.object({
  headline: z.string().min(1).max(80),
  subjectText: z.string().min(1),
  subjectType: z.enum(["celebrity", "custom"]).optional(),
  category: z.string().min(1),
  imageUrl: z.string().url().optional(),
  personId: z.string().optional(),
  description: z.string().max(140).optional(),
  timeline: z.enum(["no_deadline", "1_week", "1_month", "custom"]),
  deadlineAt: z.string().optional(),
});

export const opinionPollSuggestionSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(140).optional(),
  summary: z.string().max(200).optional(),
  category: z.string().min(1),
  imageUrl: z.string().url().optional(),
  timeline: z.enum(["no_deadline", "1_week", "1_month", "custom"]),
  deadlineAt: z.string().optional(),
  // Note: the current opinion_poll_options DB table only stores { name } per option.
  // Per-option imageUrl and personId are accepted here in the JSONB payload for
  // future use during Phase 1 approval, but will NOT be written to the options
  // table until Phase 1. See TODO in the approval handler when implemented.
  options: z
    .array(
      z.object({
        name: z.string().min(1),
        imageUrl: z.string().url().optional(),
        personId: z.string().optional(),
      })
    )
    .min(OPINION_POLL_MIN_OPTIONS)
    .max(OPINION_POLL_MAX_OPTIONS),
});

export const inductionSuggestionSchema = z.object({
  displayName: z.string().min(1),
  socialUrl: z.string().url(),
  category: z.string().optional(),
  reason: z.string().optional(),
});

// Both personId and personName are optional individually; refine enforces at least
// one must be present. Celebrity picker returns personId for known celebs;
// personName is the fallback for unrecognised names typed freeform into the combobox.
export const profileImageSuggestionSchema = z
  .object({
    personId: z.string().optional(),
    personName: z.string().min(1).optional(),
    imageUrl: z.string().url(),
    sourceCredit: z.string().optional(),
  })
  .refine((d) => d.personId || d.personName, {
    message: "Either personId or personName is required",
  });

export const openMarketSuggestionSchema = z.object({
  title: z.string().min(1),
  openMarketType: z.enum(["binary", "multi", "updown"]),
  category: z.string().min(1),
  description: z.string().max(200).optional(),
  endAt: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  coverImageUrl: z.string().url().optional(),
  personId: z.string().optional(),
  entries: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().optional(),
        imageUrl: z.string().url().optional(),
        personId: z.string().optional(),
      })
    )
    .optional(),
});

// ---- Schema dispatch map ----
const schemaMap: Record<SuggestionType, z.ZodTypeAny> = {
  matchup: matchupSuggestionSchema,
  sentiment_poll: sentimentPollSuggestionSchema,
  opinion_poll: opinionPollSuggestionSchema,
  induction: inductionSuggestionSchema,
  profile_image: profileImageSuggestionSchema,
  open_market: openMarketSuggestionSchema,
};

// ---- Exported payload types ----
export type MatchupPayload = z.infer<typeof matchupSuggestionSchema>;
export type SentimentPollPayload = z.infer<typeof sentimentPollSuggestionSchema>;
export type OpinionPollPayload = z.infer<typeof opinionPollSuggestionSchema>;
export type InductionPayload = z.infer<typeof inductionSuggestionSchema>;
export type ProfileImagePayload = z.infer<typeof profileImageSuggestionSchema>;
export type OpenMarketPayload = z.infer<typeof openMarketSuggestionSchema>;

export type SuggestionPayload =
  | ({ type: "matchup" } & MatchupPayload)
  | ({ type: "sentiment_poll" } & SentimentPollPayload)
  | ({ type: "opinion_poll" } & OpinionPollPayload)
  | ({ type: "induction" } & InductionPayload)
  | ({ type: "profile_image" } & ProfileImagePayload)
  | ({ type: "open_market" } & OpenMarketPayload);

// ---- Payload validator ----
export function validateSuggestionPayload(
  type: string,
  payload: unknown
): { success: true; data: object } | { success: false; errors: z.ZodIssue[] } {
  if (!(type in schemaMap)) {
    return {
      success: false,
      errors: [
        {
          code: "custom",
          message: `Unknown suggestion type: ${type}`,
          path: ["type"],
        } as z.ZodIssue,
      ],
    };
  }
  const result = schemaMap[type as SuggestionType].safeParse(payload);
  if (result.success) {
    return { success: true, data: result.data as object };
  }
  return { success: false, errors: result.error.issues };
}
