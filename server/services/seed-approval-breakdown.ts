import { db } from "../db";
import { supabaseServer } from "../supabase";
import { adminAuditLog, celebrityMetrics, userVotes } from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";

export type ApprovalSeedCounts = Record<"1" | "2" | "3" | "4" | "5", number>;

const RATING_KEYS = ["1", "2", "3", "4", "5"] as const;

export function parseApprovalSeedCounts(incoming: Record<string, any> | undefined): ApprovalSeedCounts {
  const parseCount = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  };
  const raw = incoming ?? {};
  return {
    "1": parseCount(raw["1"]),
    "2": parseCount(raw["2"]),
    "3": parseCount(raw["3"]),
    "4": parseCount(raw["4"]),
    "5": parseCount(raw["5"]),
  };
}

/** Current seed vote counts from user_votes (seed-system-approval%). */
export async function getSeedApprovalCounts(personId: string): Promise<ApprovalSeedCounts> {
  const seedRatingRows = await db
    .select({
      rating: userVotes.rating,
      cnt: sql<number>`cast(count(*) as int)`,
    })
    .from(userVotes)
    .where(
      and(eq(userVotes.personId, personId), sql`${userVotes.userId} LIKE 'seed-system-approval%'`),
    )
    .groupBy(userVotes.rating);

  const counts: ApprovalSeedCounts = {
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
    "5": 0,
  };
  for (const row of seedRatingRows) {
    const rating = Number(row.rating);
    if (rating >= 1 && rating <= 5) counts[String(rating) as keyof ApprovalSeedCounts] = Number(row.cnt);
  }
  return counts;
}

export function impliedAvgRating(counts: ApprovalSeedCounts): number | null {
  const t =
    counts["1"] + counts["2"] + counts["3"] + counts["4"] + counts["5"];
  if (t === 0) return null;
  const s =
    counts["1"] * 1 +
    counts["2"] * 2 +
    counts["3"] * 3 +
    counts["4"] * 4 +
    counts["5"] * 5;
  return s / t;
}

/**
 * Delete seed approval rows, insert manual seed rows, upsert celebrity_metrics (same as admin PUT).
 */
export async function replaceSeedApprovalBreakdown(opts: {
  personId: string;
  personName: string;
  counts: ApprovalSeedCounts;
  audit?: { adminId: string };
}): Promise<{
  counts: ApprovalSeedCounts;
  seedApprovalCount: number;
  seedApprovalSum: number;
  approvalVotesCount: number;
  approvalAvgRating: number | null;
  approvalPct: number | null;
}> {
  const { personId, personName, counts } = opts;
  const id = personId;

  const { error: deleteError } = await supabaseServer
    .from("user_votes")
    .delete()
    .eq("person_id", id)
    .like("user_id", "seed-system-approval%");
  if (deleteError) {
    throw new Error(`Failed to delete existing seed votes: ${deleteError.message}`);
  }

  const rows: Array<{ user_id: string; person_id: string; person_name: string; rating: number }> = [];
  for (const ratingKey of RATING_KEYS) {
    const rating = Number(ratingKey);
    for (let i = 0; i < counts[ratingKey]; i++) {
      rows.push({
        user_id: `seed-system-approval-manual-${id}-r${rating}-i${i + 1}`,
        person_id: id,
        person_name: personName,
        rating,
      });
    }
  }

  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error: insertError } = await supabaseServer.from("user_votes").insert(chunk);
    if (insertError) {
      throw new Error(`Failed to insert seed votes: ${insertError.message}`);
    }
  }

  const [allVotesAgg] = await db
    .select({
      cnt: sql<number>`cast(count(*) as int)`,
      sumRating: sql<number>`coalesce(sum(${userVotes.rating}), 0)::double precision`,
    })
    .from(userVotes)
    .where(eq(userVotes.personId, id));

  const approvalVotesCount = Number(allVotesAgg?.cnt ?? 0);
  const totalSum = Number(allVotesAgg?.sumRating ?? 0);
  const approvalAvgRating = approvalVotesCount > 0 ? totalSum / approvalVotesCount : null;
  const approvalPct = approvalAvgRating != null ? Math.round(((approvalAvgRating - 1) / 4) * 100) : null;

  const seedApprovalCount =
    counts["1"] + counts["2"] + counts["3"] + counts["4"] + counts["5"];
  const seedApprovalSum =
    counts["1"] * 1 +
    counts["2"] * 2 +
    counts["3"] * 3 +
    counts["4"] * 4 +
    counts["5"] * 5;

  await db
    .insert(celebrityMetrics)
    .values({
      celebrityId: id,
      seedApprovalCount,
      seedApprovalSum,
      approvalVotesCount,
      approvalAvgRating,
      approvalPct,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: celebrityMetrics.celebrityId,
      set: {
        seedApprovalCount,
        seedApprovalSum,
        approvalVotesCount,
        approvalAvgRating,
        approvalPct,
        updatedAt: new Date(),
      },
    });

  if (opts.audit) {
    await db.insert(adminAuditLog).values({
      adminId: opts.audit.adminId,
      adminEmail: null,
      actionType: "update_seed_approval_breakdown",
      targetTable: "user_votes",
      targetId: id,
      newData: {
        counts,
        seedApprovalCount,
        seedApprovalSum,
        approvalVotesCount,
        approvalAvgRating,
        approvalPct,
      },
    });
  }

  return {
    counts,
    seedApprovalCount,
    seedApprovalSum,
    approvalVotesCount,
    approvalAvgRating,
    approvalPct,
  };
}
