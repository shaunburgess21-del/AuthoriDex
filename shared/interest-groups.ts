/**
 * Linked interest groups — members share the same feed personalization.
 *
 * Stored `stated_interests` stays faithful to what the user tapped in the
 * picker; expansion happens at read/ranking time via expandStatedInterests().
 */

export const LINKED_INTEREST_GROUPS = [["gaming", "streaming"]] as const;

/**
 * All category ids that should match a single stated interest or audience
 * target (lowercase). Unlinked ids pass through as a one-element array.
 */
export function expandInterestId(id: string): string[] {
  const lower = id.trim().toLowerCase();
  for (const group of LINKED_INTEREST_GROUPS) {
    if ((group as readonly string[]).includes(lower)) {
      return [...group];
    }
  }
  return [lower];
}

/**
 * Expand stated interests for ranking and audience matching. If the user
 * picked any member of a linked group, all members are included (deduped).
 */
export function expandStatedInterests(interests: string[]): string[] {
  const out = new Set<string>();
  for (const raw of interests) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    for (const id of expandInterestId(raw)) {
      out.add(id);
    }
  }
  return Array.from(out);
}
