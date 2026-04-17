import { db } from "../db";
import {
  suggestions,
  matchups,
  trendingPolls,
  opinionPolls,
  opinionPollOptions,
  inductionCandidates,
  predictionMarkets,
  marketEntries,
  celebrityImages,
  trackedPeople,
  trendingPeople,
  adminAuditLog,
  type Suggestion,
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Canonical content-type labels written to suggestions.approved_as_type.
// Used by /api/suggestions/mine → user-profile live-card link-through.
// ---------------------------------------------------------------------------
export const APPROVED_AS_TYPE: Record<string, string> = {
  matchup: "matchup",
  sentiment_poll: "trending_poll",
  opinion_poll: "opinion_poll",
  induction: "induction_candidate",
  open_market: "prediction_market",
  profile_image: "celebrity_image",
};

// ---------------------------------------------------------------------------
// Slug generation. Timestamp suffix avoids collisions without a DB round-trip.
// ---------------------------------------------------------------------------
export function generateSlug(title: string): string {
  const base = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const suffix = Date.now().toString(36);
  return base ? `${base}-${suffix}` : `item-${suffix}`;
}

// Image-slug for induction candidates (mirrors server/routes.ts:349).
function generateImageSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Coerce a user-facing timeline choice into an absolute Date. 'no_deadline'
// yields null so downstream columns store NULL. A plain ISO string passes
// through as a Date; anything unparseable falls back to null.
// ---------------------------------------------------------------------------
function resolveEndDate(value: unknown): Date | null {
  if (!value) return null;
  if (value === "no_deadline") return null;
  if (value === "1_week") return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (value === "1_month") return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (value === "custom") return null; // custom without explicit date string — let admin override
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (value instanceof Date) return value;
  return null;
}

function mergeOverrides<T extends Record<string, unknown>>(
  base: T,
  overrides: Record<string, unknown> | undefined
): T {
  if (!overrides) return base;
  return { ...base, ...overrides } as T;
}

// ===========================================================================
// Pure translators — userPayload + adminOverrides → admin-insert-ready shape.
// No side effects; safe to unit-test.
// ===========================================================================

type MatchupAdminPayload = {
  title: string;
  category: string;
  optionAText: string;
  optionBText: string;
  optionAImage: string | null;
  optionBImage: string | null;
  personAId: string | null;
  personBId: string | null;
  promptText: string | null;
  description: string | null;
  slug: string;
  visibility: string;
  featured: boolean;
  seedVotesA: number;
  seedVotesB: number;
};

export function translateMatchupPayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): MatchupAdminPayload {
  const base: MatchupAdminPayload = {
    title: String(userPayload.title ?? ""),
    category: String(userPayload.category ?? "General"),
    optionAText: String(userPayload.optionAText ?? ""),
    optionBText: String(userPayload.optionBText ?? ""),
    optionAImage: userPayload.optionAImage ?? null,
    optionBImage: userPayload.optionBImage ?? null,
    personAId: userPayload.personAId ?? null,
    personBId: userPayload.personBId ?? null,
    promptText: userPayload.promptText ?? null,
    description: userPayload.description ?? null,
    slug: generateSlug(String(userPayload.title ?? "matchup")),
    visibility: "live",
    featured: false,
    seedVotesA: 0,
    seedVotesB: 0,
  };
  return mergeOverrides(base, adminOverrides);
}

type SentimentPollAdminPayload = {
  headline: string;
  subjectText: string;
  category: string;
  personId: string | null;
  description: string | null;
  timeline: string | null;
  deadlineAt: Date | null;
  imageUrl: string | null;
  slug: string;
  visibility: string;
  featured: boolean;
  seedSupportCount: number;
  seedNeutralCount: number;
  seedOpposeCount: number;
};

export function translateSentimentPollPayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): SentimentPollAdminPayload {
  const base: SentimentPollAdminPayload = {
    headline: String(userPayload.headline ?? ""),
    subjectText: String(userPayload.subjectText ?? ""),
    category: String(userPayload.category ?? "misc"),
    personId: userPayload.personId ?? null,
    description: userPayload.description ?? null,
    timeline: userPayload.timeline ?? null,
    deadlineAt: userPayload.deadlineAt ? resolveEndDate(userPayload.deadlineAt) : null,
    imageUrl: userPayload.imageUrl ?? null,
    slug: generateSlug(String(userPayload.headline ?? "poll")),
    visibility: "draft",
    featured: false,
    seedSupportCount: 0,
    seedNeutralCount: 0,
    seedOpposeCount: 0,
  };
  return mergeOverrides(base, adminOverrides);
}

type OpinionPollOptionAdminPayload = {
  name: string;
  imageUrl: string | null;
  personId: string | null;
  seedCount: number;
};

type OpinionPollAdminPayload = {
  title: string;
  slug: string;
  category: string;
  description: string | null;
  summary: string | null;
  imageUrl: string | null;
  featured: boolean;
  visibility: string;
  options: OpinionPollOptionAdminPayload[];
};

export function translateOpinionPollPayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): OpinionPollAdminPayload {
  const rawOptions: any[] = Array.isArray(userPayload.options) ? userPayload.options : [];
  const base: OpinionPollAdminPayload = {
    title: String(userPayload.title ?? ""),
    slug: generateSlug(String(userPayload.title ?? "opinion-poll")),
    category: String(userPayload.category ?? "misc"),
    description: userPayload.description ?? null,
    summary: userPayload.summary ?? null,
    imageUrl: userPayload.imageUrl ?? null,
    featured: false,
    visibility: "draft",
    options: rawOptions.map((opt) => ({
      name: String(opt?.name ?? ""),
      imageUrl: opt?.imageUrl ?? null,
      personId: opt?.personId ?? null,
      seedCount: 0,
    })),
  };
  return mergeOverrides(base, adminOverrides);
}

type InductionAdminPayload = {
  displayName: string;
  category: string;
  imageSlug: string;
  wikiSlug: string | null;
  xHandle: string | null;
  seedVotes: number;
  inductionStatus: string;
  isActive: boolean;
  socialUrl: string | null;
  reason: string | null;
};

// Extract @handle from an X/Twitter URL; return null if it isn't one.
function extractXHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!/^(www\.)?(x|twitter)\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    return parts[0].replace(/^@+/, "");
  } catch {
    return null;
  }
}

export function translateInductionPayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): InductionAdminPayload {
  const displayName = String(userPayload.displayName ?? "");
  const base: InductionAdminPayload = {
    displayName,
    category: String(userPayload.category ?? "Misc"),
    imageSlug: generateImageSlug(displayName) || generateSlug(displayName),
    wikiSlug: null,
    xHandle: extractXHandle(userPayload.socialUrl),
    seedVotes: 0,
    inductionStatus: "Queue",
    isActive: true,
    // Metadata fields kept for audit/review context; they are not written to
    // induction_candidates (no column), but the dispatcher preserves them via
    // the audit log's newData field.
    socialUrl: userPayload.socialUrl ?? null,
    reason: userPayload.reason ?? null,
  };
  return mergeOverrides(base, adminOverrides);
}

type ProfileImageAdminPayload = {
  personId: string;
  imageUrl: string;
  source: string;
};

export function translateProfileImagePayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): ProfileImageAdminPayload {
  const personId = String(userPayload.personId ?? "").trim();
  if (!personId) {
    throw new Error(
      "Profile image approval requires a valid personId. The submitter entered a name instead of selecting a known celebrity — reject this suggestion and ask them to resubmit with a celebrity selected from the picker."
    );
  }
  const sourceCredit = userPayload.sourceCredit
    ? `user_suggestion:${String(userPayload.sourceCredit)}`
    : "user_suggestion";
  const base: ProfileImageAdminPayload = {
    personId,
    imageUrl: String(userPayload.imageUrl ?? ""),
    source: sourceCredit,
  };
  return mergeOverrides(base, adminOverrides);
}

type OpenMarketEntryAdminPayload = {
  label: string;
  description: string | null;
  imageUrl: string | null;
  personId: string | null;
  seedCount: number;
};

type OpenMarketAdminPayload = {
  title: string;
  slug: string;
  openMarketType: "binary" | "multi" | "updown";
  category: string | null;
  description: string | null;
  teaser: string | null;
  summary: string | null;
  coverImageUrl: string | null;
  sourceUrl: string | null;
  featured: boolean;
  timezone: string;
  startAt: Date;
  endAt: Date;
  closeAt: Date | null;
  personId: string | null;
  isLive: boolean;
  visibility: string;
  seedParticipants: number;
  seedVolume: string;
  underlying: string | null;
  metric: string | null;
  strike: string | null; // numeric stored as string in Drizzle
  unit: string | null;
  entries: OpenMarketEntryAdminPayload[];
};

export function translateOpenMarketPayload(
  userPayload: Record<string, any>,
  adminOverrides?: Record<string, unknown>
): OpenMarketAdminPayload {
  const marketType = (userPayload.openMarketType ?? "binary") as "binary" | "multi" | "updown";

  // Synthesize entries if missing per type. Phase 1f.2 sends entries for
  // multi only; binary and updown rely on synthesis.
  let entries: OpenMarketEntryAdminPayload[];
  if (Array.isArray(userPayload.entries) && userPayload.entries.length > 0) {
    entries = userPayload.entries.map((e: any) => ({
      label: String(e?.label ?? ""),
      description: e?.description ?? null,
      imageUrl: e?.imageUrl ?? null,
      personId: e?.personId ?? null,
      seedCount: 0,
    }));
  } else if (marketType === "binary") {
    entries = [
      { label: "Yes", description: null, imageUrl: null, personId: null, seedCount: 0 },
      { label: "No",  description: null, imageUrl: null, personId: null, seedCount: 0 },
    ];
  } else if (marketType === "updown") {
    entries = [
      { label: "Above", description: null, imageUrl: null, personId: null, seedCount: 0 },
      { label: "Below", description: null, imageUrl: null, personId: null, seedCount: 0 },
    ];
  } else {
    entries = [];
  }

  // Strike may arrive as string or number; coerce via Number then back to string
  // because predictionMarkets.strike is a numeric column (Drizzle expects string).
  let strikeStr: string | null = null;
  if (userPayload.strike !== undefined && userPayload.strike !== null && userPayload.strike !== "") {
    const n = Number(userPayload.strike);
    if (!Number.isNaN(n)) strikeStr = String(n);
  }

  const resolvedEnd = resolveEndDate(userPayload.endAt) ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const base: OpenMarketAdminPayload = {
    title: String(userPayload.title ?? ""),
    slug: generateSlug(String(userPayload.title ?? "market")),
    openMarketType: marketType,
    category: userPayload.category ?? null,
    description: userPayload.description ?? null,
    teaser: null,
    summary: null,
    coverImageUrl: userPayload.coverImageUrl ?? null,
    sourceUrl: userPayload.sourceUrl ?? null,
    featured: false,
    timezone: "UTC",
    startAt: new Date(),
    endAt: resolvedEnd,
    closeAt: null,
    personId: userPayload.personId ?? null,
    isLive: true,
    visibility: "live",
    seedParticipants: 0,
    seedVolume: "0",
    underlying: userPayload.underlying ?? null,
    metric: userPayload.metric ?? null,
    strike: strikeStr,
    unit: userPayload.unit ?? null,
    entries,
  };
  return mergeOverrides(base, adminOverrides);
}

// ===========================================================================
// Dispatcher — side-effectful, orchestrates translator + DB insert per type.
// Returns the created row's ID plus the canonical approved_as_type label.
// ===========================================================================

export type ApprovalResult = {
  approvedAsId: string;
  approvedAsType: string;
};

export async function dispatchApproval(
  suggestion: Suggestion,
  adminId: string,
  adminOverrides?: Record<string, unknown>
): Promise<ApprovalResult> {
  const userPayload = (suggestion.payload ?? {}) as Record<string, any>;

  switch (suggestion.type) {
    case "matchup": {
      const p = translateMatchupPayload(userPayload, adminOverrides);

      const [maxOrder] = await db
        .select({ max: sql<number>`COALESCE(MAX(display_order), 0)` })
        .from(matchups);
      const nextOrder = (maxOrder?.max || 0) + 1;

      const [created] = await db
        .insert(matchups)
        .values({
          title: p.title,
          category: p.category,
          optionAText: p.optionAText,
          optionBText: p.optionBText,
          optionAImage: p.optionAImage,
          optionBImage: p.optionBImage,
          personAId: p.personAId,
          personBId: p.personBId,
          promptText: p.promptText,
          description: p.description,
          slug: p.slug,
          visibility: p.visibility,
          featured: p.featured,
          isActive: p.visibility === "live",
          displayOrder: nextOrder,
          seedVotesA: p.seedVotesA,
          seedVotesB: p.seedVotesB,
        })
        .returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_matchup",
        targetTable: "face_offs",
        targetId: created.id,
        newData: created,
        metadata: { suggestionId: suggestion.id },
      });

      return { approvedAsId: created.id, approvedAsType: APPROVED_AS_TYPE.matchup };
    }

    case "sentiment_poll": {
      const p = translateSentimentPollPayload(userPayload, adminOverrides);
      const effectiveStatus = p.visibility === "inactive" ? "draft" : p.visibility;

      const [created] = await db
        .insert(trendingPolls)
        .values({
          status: effectiveStatus as any,
          category: p.category,
          headline: p.headline,
          subjectText: p.subjectText,
          personId: p.personId,
          description: p.description,
          timeline: p.timeline,
          deadlineAt: p.deadlineAt,
          imageUrl: p.imageUrl,
          seedSupportCount: p.seedSupportCount,
          seedNeutralCount: p.seedNeutralCount,
          seedOpposeCount: p.seedOpposeCount,
          slug: p.slug,
          featured: p.featured,
          visibility: p.visibility,
          createdBy: adminId,
        })
        .returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_sentiment_poll",
        targetTable: "trending_polls",
        targetId: created.id,
        newData: created,
        metadata: { suggestionId: suggestion.id },
      });

      return { approvedAsId: created.id, approvedAsType: APPROVED_AS_TYPE.sentiment_poll };
    }

    case "opinion_poll": {
      const p = translateOpinionPollPayload(userPayload, adminOverrides);

      const [created] = await db
        .insert(opinionPolls)
        .values({
          title: p.title,
          slug: p.slug,
          category: p.category,
          description: p.description,
          summary: p.summary,
          imageUrl: p.imageUrl,
          featured: p.featured,
          visibility: p.visibility,
          createdBy: adminId,
        })
        .returning();

      if (p.options.length > 0) {
        await db.insert(opinionPollOptions).values(
          p.options.map((opt, i) => ({
            pollId: created.id,
            name: opt.name,
            imageUrl: opt.imageUrl,
            personId: opt.personId,
            orderIndex: i,
            seedCount: opt.seedCount,
          }))
        );
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_opinion_poll",
        targetTable: "opinion_polls",
        targetId: created.id,
        newData: { ...created, options: p.options },
        metadata: { suggestionId: suggestion.id },
      });

      return { approvedAsId: created.id, approvedAsType: APPROVED_AS_TYPE.opinion_poll };
    }

    case "induction": {
      const p = translateInductionPayload(userPayload, adminOverrides);

      const [created] = await db
        .insert(inductionCandidates)
        .values({
          displayName: p.displayName,
          category: p.category,
          imageSlug: p.imageSlug,
          wikiSlug: p.wikiSlug,
          xHandle: p.xHandle,
          seedVotes: p.seedVotes,
          inductionStatus: p.inductionStatus,
          isActive: p.isActive,
        })
        .returning();

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_induction",
        targetTable: "induction_candidates",
        targetId: created.id,
        newData: { ...created, socialUrl: p.socialUrl, reason: p.reason },
        metadata: { suggestionId: suggestion.id },
      });

      return { approvedAsId: created.id, approvedAsType: APPROVED_AS_TYPE.induction };
    }

    case "open_market": {
      const p = translateOpenMarketPayload(userPayload, adminOverrides);

      if (p.openMarketType === "updown" && (!p.underlying || !p.strike || !p.unit)) {
        throw new Error("Up/Down markets require underlying, strike, and unit. Use adminOverrides to supply missing fields.");
      }
      if (p.entries.length === 0) {
        throw new Error("open_market approval requires at least one entry.");
      }

      const [created] = await db
        .insert(predictionMarkets)
        .values({
          marketType: "community",
          status: "OPEN",
          title: p.title,
          slug: p.slug,
          openMarketType: p.openMarketType,
          category: p.category,
          description: p.description,
          teaser: p.teaser,
          summary: p.summary,
          coverImageUrl: p.coverImageUrl,
          sourceUrl: p.sourceUrl,
          featured: p.featured,
          timezone: p.timezone,
          startAt: p.startAt,
          endAt: p.endAt,
          closeAt: p.closeAt,
          personId: p.personId,
          isLive: p.isLive,
          visibility: p.visibility,
          seedParticipants: p.seedParticipants,
          seedVolume: p.seedVolume,
          underlying: p.underlying,
          metric: p.metric,
          strike: p.strike,
          unit: p.unit,
          createdBy: adminId,
        })
        .returning();

      await db.insert(marketEntries).values(
        p.entries.map((e, i) => ({
          marketId: created.id,
          entryType: e.personId ? ("person" as const) : ("custom" as const),
          personId: e.personId,
          label: e.label,
          description: e.description,
          displayOrder: i,
          seedCount: e.seedCount,
          imageUrl: e.imageUrl,
        }))
      );

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_open_market",
        targetTable: "prediction_markets",
        targetId: created.id,
        newData: { ...created, entries: p.entries },
        metadata: { suggestionId: suggestion.id },
      });

      return { approvedAsId: created.id, approvedAsType: APPROVED_AS_TYPE.open_market };
    }

    case "profile_image": {
      const p = translateProfileImagePayload(userPayload, adminOverrides);

      const existingImages = await db
        .select({ id: celebrityImages.id })
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, p.personId))
        .limit(1);
      const isFirst = existingImages.length === 0;

      const [created] = await db
        .insert(celebrityImages)
        .values({
          personId: p.personId,
          imageUrl: p.imageUrl,
          source: p.source,
          isPrimary: isFirst,
          votesUp: 0,
          votesDown: 0,
        })
        .returning();

      if (isFirst) {
        await db.update(trackedPeople).set({ avatar: p.imageUrl }).where(eq(trackedPeople.id, p.personId));
        await db.update(trendingPeople).set({ avatar: p.imageUrl }).where(eq(trendingPeople.id, p.personId));
      }

      await db.insert(adminAuditLog).values({
        adminId,
        adminEmail: null,
        actionType: "approve_suggestion_profile_image",
        targetTable: "celebrity_images",
        targetId: created.id,
        newData: created,
        metadata: { suggestionId: suggestion.id },
      });

      // approvedAsId = personId so the user-profile link-through navigates
      // to the celebrity's profile page (/person/:id).
      return { approvedAsId: p.personId, approvedAsType: APPROVED_AS_TYPE.profile_image };
    }

    default:
      throw new Error(`Unsupported suggestion type: ${suggestion.type}`);
  }
}

// Exported for routes.ts — keeps route handler terse.
export async function markSuggestionApproved(
  suggestionId: string,
  approvedAsId: string,
  approvedAsType: string,
  adminId: string
): Promise<void> {
  await db
    .update(suggestions)
    .set({
      status: "approved",
      approvedAsId,
      approvedAsType,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(suggestions.id, suggestionId));
}

export async function markSuggestionRejected(
  suggestionId: string,
  adminId: string,
  adminNotes: string | null
): Promise<void> {
  await db
    .update(suggestions)
    .set({
      status: "rejected",
      adminNotes,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(suggestions.id, suggestionId));
}
