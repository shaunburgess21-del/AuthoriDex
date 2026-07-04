import { inArray } from "drizzle-orm";
import { db } from "../db";
import { profiles, trackedPeople } from "@shared/schema";
import {
  MAX_MENTIONS_PER_BODY,
  extractMentions,
  serializeMention,
  type MentionToken,
} from "@shared/lib/mentions";
import { createNotification } from "./notifications";
import { logger } from "../log";

export interface SanitizedMentions {
  /** Body with any invalid mention tokens downgraded to plain `@Display` text. */
  body: string;
  /** Valid user mentions (profiles that exist) for notification fanout. */
  userMentions: MentionToken[];
  /** Set when the body breaks a hard rule (caller should 400). */
  error?: string;
}

/**
 * Validate the mention tokens embedded in a comment/post body.
 *
 * - Caps mentions at MAX_MENTIONS_PER_BODY (hard error — tokens are only
 *   produced by the composer dropdown, so exceeding the cap means abuse).
 * - Tokens referencing nonexistent people/users are downgraded to plain
 *   `@Display` text rather than rejected (stale id, deleted account).
 */
export async function sanitizeMentions(body: string): Promise<SanitizedMentions> {
  const tokens = extractMentions(body);
  if (tokens.length === 0) return { body, userMentions: [] };
  if (tokens.length > MAX_MENTIONS_PER_BODY) {
    return { body, userMentions: [], error: `A post can mention at most ${MAX_MENTIONS_PER_BODY} people` };
  }

  const personIds = [...new Set(tokens.filter((t) => t.type === "person").map((t) => t.id))];
  const userIds = [...new Set(tokens.filter((t) => t.type === "user").map((t) => t.id))];

  const validPersonIds = new Set<string>();
  if (personIds.length > 0) {
    const rows = await db
      .select({ id: trackedPeople.id })
      .from(trackedPeople)
      .where(inArray(trackedPeople.id, personIds));
    for (const r of rows) validPersonIds.add(r.id);
  }

  const validUserIds = new Set<string>();
  if (userIds.length > 0) {
    const rows = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(inArray(profiles.id, userIds));
    for (const r of rows) validUserIds.add(r.id);
  }

  let sanitized = body;
  const userMentions: MentionToken[] = [];
  const seenUsers = new Set<string>();
  for (const token of tokens) {
    const valid = token.type === "person" ? validPersonIds.has(token.id) : validUserIds.has(token.id);
    if (!valid) {
      sanitized = sanitized.replace(serializeMention(token), `@${token.display}`);
      continue;
    }
    if (token.type === "user" && !seenUsers.has(token.id)) {
      seenUsers.add(token.id);
      userMentions.push(token);
    }
  }

  return { body: sanitized, userMentions };
}

export interface MentionNotifyInput {
  userMentions: MentionToken[];
  authorId: string;
  authorUsername: string | null;
  /** Id of the comment/insight that contains the mention (idempotency anchor). */
  contentId: string;
  entityType: "comment" | "community_insight";
  href: string;
  /** Plain-text snippet of the body (mention tokens already collapsed). */
  snippet: string;
}

/**
 * Fan out `mention` notifications to every mentioned VoxDex user.
 * Best-effort: failures are logged and never break the originating flow.
 * Self-mentions are skipped; idempotency key is per (content, user).
 */
export async function notifyMentionedUsers(input: MentionNotifyInput): Promise<void> {
  const authorName = input.authorUsername ?? "Someone";
  for (const mention of input.userMentions) {
    if (mention.id === input.authorId) continue;
    try {
      await createNotification({
        userId: mention.id,
        kind: "mention",
        actorUserId: input.authorId,
        title: `${authorName} mentioned you`,
        body: input.snippet.slice(0, 140) || undefined,
        href: input.href,
        entityType: input.entityType,
        entityId: input.contentId,
        groupKey: `mentions:${input.contentId}`,
        idempotencyKey: `mention:${input.contentId}:${mention.id}`,
      });
    } catch (err) {
      logger.warn({ err, contentId: input.contentId, mentionedUserId: mention.id }, "[mentions] notification fanout failed");
    }
  }
}
