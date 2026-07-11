/**
 * Vote Scout — tracked people name → id resolver.
 *
 * Loads main_leaderboard + active induction shadow profiles for prompt
 * context and Approve-to-Draft person linking.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { inductionCandidates, trackedPeople } from "@shared/schema";

export type VoteScoutPersonRef = {
  id: string;
  name: string;
  source: "main_leaderboard" | "induction";
};

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build an exact case-insensitive name → person map covering:
 * - tracked_people with status = main_leaderboard
 * - active induction_candidates joined to induction shadow tracked_people
 */
export async function loadVoteScoutPeople(): Promise<{
  byName: Map<string, VoteScoutPersonRef>;
  leaderboardNames: string[];
  inductionNames: string[];
}> {
  const [mainRows, inductionRows] = await Promise.all([
    db
      .select({ id: trackedPeople.id, name: trackedPeople.name })
      .from(trackedPeople)
      .where(eq(trackedPeople.status, "main_leaderboard")),
    db
      .select({
        id: trackedPeople.id,
        name: inductionCandidates.displayName,
      })
      .from(inductionCandidates)
      .innerJoin(
        trackedPeople,
        sql`LOWER(TRIM(${trackedPeople.name})) = LOWER(TRIM(${inductionCandidates.displayName}))`,
      )
      .where(
        and(
          eq(inductionCandidates.isActive, true),
          eq(trackedPeople.status, "induction"),
        ),
      ),
  ]);

  const byName = new Map<string, VoteScoutPersonRef>();
  const leaderboardNames: string[] = [];
  const inductionNames: string[] = [];

  for (const row of mainRows) {
    const key = nameKey(row.name);
    if (!key) continue;
    // Prefer main_leaderboard if a name somehow appears twice.
    byName.set(key, {
      id: row.id,
      name: row.name,
      source: "main_leaderboard",
    });
    leaderboardNames.push(row.name);
  }

  for (const row of inductionRows) {
    const key = nameKey(row.name);
    if (!key) continue;
    if (!byName.has(key)) {
      byName.set(key, {
        id: row.id,
        name: row.name,
        source: "induction",
      });
    }
    inductionNames.push(row.name);
  }

  leaderboardNames.sort((a, b) => a.localeCompare(b));
  inductionNames.sort((a, b) => a.localeCompare(b));

  return { byName, leaderboardNames, inductionNames };
}

/** Resolve an exact tracked name to a person id, or null. */
export function resolvePersonIdByName(
  name: string,
  byName: Map<string, VoteScoutPersonRef>,
): string | null {
  return byName.get(nameKey(name))?.id ?? null;
}

/**
 * Resolve a list of related names (from GPT) and option/side labels to person ids.
 * Returns unique matches preserving first-seen order of names.
 */
export function resolveRelatedPersonIds(
  names: string[],
  byName: Map<string, VoteScoutPersonRef>,
): Array<{ name: string; id: string; source: VoteScoutPersonRef["source"] }> {
  const out: Array<{ name: string; id: string; source: VoteScoutPersonRef["source"] }> = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const ref = byName.get(nameKey(raw));
    if (!ref || seen.has(ref.id)) continue;
    seen.add(ref.id);
    out.push({ name: ref.name, id: ref.id, source: ref.source });
  }
  return out;
}

/** Cap name lists for the LLM prompt (token budget). */
export function capNamesForPrompt(names: string[], limit = 120): string[] {
  if (names.length <= limit) return names;
  return names.slice(0, limit);
}
