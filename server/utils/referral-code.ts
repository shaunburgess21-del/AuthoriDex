import { eq } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";

/**
 * Base32-ish alphabet used for referral codes — A–Z minus look-alikes
 * (I/O/L) and 2–9 minus 0/1. Keeps the 6-char suffix readable and
 * typeable on a phone. Collision rate ≈ 1 / 31^6 (≈ 1 / 887M) per
 * pull, so a single retry is overwhelmingly enough; we still loop
 * with onConflictDoNothing-style precheck so a freak repeat in the
 * next decade doesn't crash signup.
 */
const REFERRAL_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Generate a unique 8-char referral code ("VX" + 6 alphabet chars).
 *
 * Returns null after `maxAttempts` collisions so callers can decide
 * whether to fail the signup or continue without a code (we choose
 * the latter — a missing code only blocks the user from sharing a
 * referral, not from using the app).
 *
 * Lives in its own util so:
 *   - `POST /api/profile/sync` can mint the code at signup time
 *   - the one-shot backfill admin endpoint can mint codes for
 *     pre-overhaul accounts whose row was inserted before this
 *     column existed
 *   - any future admin tool ("regenerate this user's code") can
 *     reuse the same uniqueness check
 */
export async function generateUniqueReferralCode(maxAttempts = 5): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += REFERRAL_CODE_ALPHABET[
        Math.floor(Math.random() * REFERRAL_CODE_ALPHABET.length)
      ];
    }
    const candidate = `VX${suffix}`;
    const collision = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.referralCode, candidate))
      .limit(1);
    if (collision.length === 0) return candidate;
  }
  console.warn("[referral-code] generateUniqueReferralCode exhausted attempts");
  return null;
}
