import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import {
  isValidUsername,
  pseudonymWithNewSuffix,
  randomPseudonymCandidate,
} from "@shared/lib/username/suggest-pseudonym";

async function isUsernameTaken(username: string): Promise<boolean> {
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.username, username))
    .limit(1);
  return existing.length > 0;
}

/**
 * Generate a pseudonym guaranteed available in `profiles.username`.
 * On collision: bump the numeric suffix first, then full re-roll.
 */
export async function generateAvailablePseudonym(maxAttempts = 20): Promise<string> {
  let candidate = randomPseudonymCandidate();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!isValidUsername(candidate.username)) {
      candidate = randomPseudonymCandidate();
      continue;
    }

    if (!(await isUsernameTaken(candidate.username))) {
      return candidate.username;
    }

    // Same adj+noun, different suffix before a full re-roll.
    if (attempt % 2 === 0) {
      candidate = pseudonymWithNewSuffix(
        candidate.adj,
        candidate.noun,
        candidate.num,
      );
    } else {
      candidate = randomPseudonymCandidate();
    }
  }

  console.warn("[suggested-username] generateAvailablePseudonym exhausted attempts");
  throw new Error("Could not generate an available username");
}
