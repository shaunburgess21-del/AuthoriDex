/**
 * Inline mention tokens embedded in comment/post body text.
 *
 * Format: `@[Display Name](person:<id>)` or `@[username](user:<id>)`
 *
 * - `person` mentions reference `tracked_people.id` (leaderboard celebrities
 *   and induction-queue candidates alike).
 * - `user` mentions reference `profiles.id`; the display text is the username
 *   at write time.
 *
 * Bodies remain plain text otherwise — a literal `@Whatever` that was never
 *  picked from the suggestion dropdown stays literal.
 */

export type MentionType = "person" | "user";

export interface MentionToken {
  type: MentionType;
  id: string;
  display: string;
}

export interface MentionSegment {
  kind: "text" | "mention";
  text: string;
  mention?: MentionToken;
}

/** Hard cap on mentions per body to prevent notification spam. */
export const MAX_MENTIONS_PER_BODY = 10;

// Display names are limited to avoid pathological bodies; ids are uuid-ish
// (also matches numeric/varchar ids). The display group disallows `]` and
// newlines; the id group disallows `)` and whitespace.
const MENTION_TOKEN_RE = /@\[([^\]\n]{1,80})\]\((person|user):([A-Za-z0-9_-]{1,64})\)/g;

export function serializeMention(token: MentionToken): string {
  return `@[${token.display}](${token.type}:${token.id})`;
}

/** All well-formed mention tokens in a body, in order of appearance. */
export function extractMentions(body: string): MentionToken[] {
  const out: MentionToken[] = [];
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    out.push({ display: m[1], type: m[2] as MentionType, id: m[3] });
  }
  return out;
}

/** Split a body into plain-text and mention segments for rendering. */
export function splitMentionSegments(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  for (const m of body.matchAll(MENTION_TOKEN_RE)) {
    const index = m.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: body.slice(lastIndex, index) });
    }
    const mention: MentionToken = { display: m[1], type: m[2] as MentionType, id: m[3] };
    segments.push({ kind: "mention", text: `@${mention.display}`, mention });
    lastIndex = index + m[0].length;
  }
  if (lastIndex < body.length) {
    segments.push({ kind: "text", text: body.slice(lastIndex) });
  }
  return segments;
}

/**
 * Convert a plain display-text body (what the user sees in the textarea,
 * e.g. `... @Trevor Noah ...`) into the token form by replacing each
 * tracked `@Display` occurrence with its serialized token. Mentions whose
 * display text was edited away simply never match and stay plain text.
 */
export function serializeBodyWithMentions(body: string, mentions: MentionToken[]): string {
  if (mentions.length === 0) return body;
  // Dedupe, then longest display first so overlapping names match greedily
  // ("Trevor Noah Jr" wins over "Trevor Noah" at the same position).
  const unique = [...new Map(mentions.map((m) => [`${m.type}:${m.id}:${m.display}`, m])).values()].sort(
    (a, b) => b.display.length - a.display.length,
  );
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "@") {
      const match = unique.find((m) => {
        if (!body.startsWith(m.display, i + 1)) return false;
        const after = body[i + 1 + m.display.length];
        return after === undefined || !/[A-Za-z0-9_]/.test(after);
      });
      if (match) {
        out += serializeMention(match);
        i += 1 + match.display.length;
        continue;
      }
    }
    out += body[i];
    i += 1;
  }
  return out;
}

/** Body with mention tokens collapsed to their display text (`@Name`). */
export function mentionsToPlainText(body: string): string {
  return body.replace(MENTION_TOKEN_RE, (_full, display: string) => `@${display}`);
}

/** Length of the body as the user perceives it (tokens count as `@Name`). */
export function mentionAwareLength(body: string): number {
  return mentionsToPlainText(body).length;
}
