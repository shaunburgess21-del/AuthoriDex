/**
 * Persist moderation decisions and apply comment hide/restore actions.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  adminAuditLog,
  comments,
  moderationEvents,
} from "@shared/schema";
import { moderateText } from "./text";
import type {
  ApplyModerationInput,
  ModerationEventStatus,
  TextModerationResult,
} from "./types";

export interface AppliedModeration {
  result: TextModerationResult;
  eventId: string | null;
  /** True when a comment row was flipped to hidden. */
  hidden: boolean;
}

/**
 * Run text moderation and, when decision is review/auto_hide, insert a
 * moderation_events row. For comments with auto_hide, also set moderation_status.
 *
 * Fail-open: if decision is allow (including API errors), no event is written
 * unless failOpenQueue is forced by the caller later.
 */
export async function applyTextModeration(
  input: ApplyModerationInput,
): Promise<AppliedModeration> {
  const result = await moderateText(input.text);

  if (result.decision === "allow") {
    return { result, eventId: null, hidden: false };
  }

  const [event] = await db
    .insert(moderationEvents)
    .values({
      contentType: input.contentType,
      contentId: input.contentId,
      authorId: input.authorId,
      decision: result.decision,
      status: "pending",
      provider: result.provider,
      flagged: result.flagged,
      scores: result.scores,
      matchedCategories: result.matchedCategories,
      sampleText: result.sampleText,
      metadata: input.metadata ?? null,
    })
    .returning({ id: moderationEvents.id });

  let hidden = false;
  if (
    result.decision === "auto_hide" &&
    input.contentType === "comment"
  ) {
    await db
      .update(comments)
      .set({ moderationStatus: "hidden", updatedAt: new Date() })
      .where(eq(comments.id, input.contentId));
    hidden = true;
  }

  return { result, eventId: event?.id ?? null, hidden };
}

/**
 * Admin: approve (restore visibility) or remove a queued item.
 */
export async function resolveModerationEvent(opts: {
  eventId: string;
  adminId: string;
  action: "approve" | "remove" | "dismiss";
  reason?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [event] = await db
    .select()
    .from(moderationEvents)
    .where(eq(moderationEvents.id, opts.eventId))
    .limit(1);

  if (!event) return { ok: false, error: "Event not found" };
  if (event.status !== "pending") {
    return { ok: false, error: "Event already resolved" };
  }

  const now = new Date();
  let newStatus: ModerationEventStatus;
  if (opts.action === "approve") newStatus = "approved";
  else if (opts.action === "remove") newStatus = "removed";
  else newStatus = "dismissed";

  if (event.contentType === "comment") {
    if (opts.action === "approve") {
      await db
        .update(comments)
        .set({ moderationStatus: "visible", updatedAt: now })
        .where(eq(comments.id, event.contentId));
    } else if (opts.action === "remove") {
      await db
        .update(comments)
        .set({
          moderationStatus: "hidden",
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(comments.id, event.contentId));
    }
  }

  if (
    event.contentType === "opinion_option_suggestion" &&
    opts.action === "remove"
  ) {
    // Soft-reject via status update — imported lazily to avoid cycles.
    const { opinionPollOptionSuggestions } = await import("@shared/schema");
    await db
      .update(opinionPollOptionSuggestions)
      .set({
        status: "rejected",
        reviewedBy: opts.adminId,
        reviewedAt: now,
        adminNotes: opts.reason ?? "Removed by moderation queue",
        updatedAt: now,
      })
      .where(eq(opinionPollOptionSuggestions.id, event.contentId));
  }

  await db
    .update(moderationEvents)
    .set({
      status: newStatus,
      reviewedBy: opts.adminId,
      reviewedAt: now,
      reviewNote: opts.reason ?? null,
    })
    .where(eq(moderationEvents.id, opts.eventId));

  await db.insert(adminAuditLog).values({
    adminId: opts.adminId,
    adminEmail: null,
    actionType: `moderation_${opts.action}`,
    targetTable: "moderation_events",
    targetId: opts.eventId,
    previousData: {
      status: event.status,
      decision: event.decision,
      contentType: event.contentType,
      contentId: event.contentId,
    },
    newData: { status: newStatus },
    metadata: { reason: opts.reason ?? null },
  });

  return { ok: true };
}

/**
 * Restrict profile avatar/banner URLs to our avatars bucket.
 */
export function isAllowedAvatarsBucketUrl(url: string): boolean {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!supabaseUrl) return false;
  const prefix = `${supabaseUrl}/storage/v1/object/public/avatars/`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    // Allow cache-bust query (?v=…)
    const withoutQuery = `${parsed.origin}${parsed.pathname}`;
    return withoutQuery.startsWith(prefix);
  } catch {
    return false;
  }
}

/** Google-hosted profile photo hosts (OAuth `picture` / `avatar_url`). */
export function isAllowedGoogleAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "lh3.google.com" ||
      host === "googleusercontent.com" ||
      host.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

/**
 * Allowed live avatar sources for launch: generative uploads in our
 * `avatars` bucket, or Google OAuth profile photos (Google-hosted CDN).
 * Arbitrary external / user-upload URLs remain blocked.
 */
export function isAllowedProfileAvatarUrl(url: string): boolean {
  return isAllowedAvatarsBucketUrl(url) || isAllowedGoogleAvatarUrl(url);
}
