/**
 * One-shot backfill: assign a unique referral_code to every
 * profile row that's still NULL after migration 0059 landed.
 *
 * Lazy generation in /api/profile/sync only fires when an existing
 * user re-syncs (e.g. opens the app fresh), which leaves accounts
 * without a recent session in a half-state until they next visit —
 * during which time the /me Refer a Friend card silently hides.
 *
 * Idempotent: re-running the script on a fully-backfilled DB is a
 * no-op (the WHERE clause selects zero rows).
 *
 * Usage:
 *   node --env-file=.env --import tsx server/scripts/backfill-referral-codes.ts
 */

import { eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { profiles } from "@shared/schema";
import { generateUniqueReferralCode } from "../utils/referral-code";

async function main() {
  const missing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(isNull(profiles.referralCode));

  console.log(`[backfill-referral-codes] candidates: ${missing.length}`);

  let updated = 0;
  let exhausted = 0;
  for (const row of missing) {
    const code = await generateUniqueReferralCode();
    if (!code) {
      exhausted += 1;
      console.warn(`[backfill-referral-codes] exhausted attempts for userId=${row.id}`);
      continue;
    }
    await db
      .update(profiles)
      .set({ referralCode: code })
      .where(eq(profiles.id, row.id));
    updated += 1;
  }

  console.log(
    `[backfill-referral-codes] done — updated=${updated} exhausted=${exhausted}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-referral-codes] failed", err);
    process.exit(1);
  });
