#!/usr/bin/env npx tsx
import { supabaseServer } from "../server/supabase";
import { db } from "../server/db";
import { celebrityMetrics } from "../shared/schema";
import { eq } from "drizzle-orm";

const SEED_PREFIX = "seed-system-approval";
const REDUCTION_RATIO = 0.125; // 12.5%

type SeedVoteRow = {
  id: string;
  person_id: string;
};

async function fetchAllSeedVotes(): Promise<SeedVoteRow[]> {
  const pageSize = 1000;
  let offset = 0;
  const rows: SeedVoteRow[] = [];

  while (true) {
    const { data, error } = await supabaseServer
      .from("user_votes")
      .select("id,person_id")
      .like("user_id", `${SEED_PREFIX}%`)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`Failed to fetch seed votes: ${error.message}`);
    if (!data || data.length === 0) break;

    rows.push(...(data as SeedVoteRow[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

async function recomputeApprovalMetrics(personId: string) {
  const { data: votes, error } = await supabaseServer
    .from("user_votes")
    .select("rating")
    .eq("person_id", personId);

  if (error) throw new Error(`Failed reading votes for ${personId}: ${error.message}`);

  const total = (votes ?? []).length;
  const sum = (votes ?? []).reduce((acc, vote: any) => acc + Number(vote.rating || 0), 0);
  const avg = total > 0 ? sum / total : null;
  const pct = avg != null ? Math.round(((avg - 1) / 4) * 100) : null;

  await db
    .update(celebrityMetrics)
    .set({
      approvalVotesCount: total,
      approvalAvgRating: avg,
      approvalPct: pct,
      updatedAt: new Date(),
    })
    .where(eq(celebrityMetrics.celebrityId, personId));
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`[SeedReduction] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[SeedReduction] Reduction ratio per person: ${REDUCTION_RATIO * 100}%`);

  const seedVotes = await fetchAllSeedVotes();
  console.log(`[SeedReduction] Found ${seedVotes.length} seeded approval votes`);

  const byPerson = new Map<string, string[]>();
  for (const row of seedVotes) {
    const arr = byPerson.get(row.person_id) ?? [];
    arr.push(row.id);
    byPerson.set(row.person_id, arr);
  }

  const plan = Array.from(byPerson.entries()).map(([personId, ids]) => {
    const current = ids.length;
    const removeCount = Math.min(current, Math.round(current * REDUCTION_RATIO));
    return { personId, current, removeCount, keep: current - removeCount, ids };
  });

  plan.sort((a, b) => b.current - a.current);
  const totalRemove = plan.reduce((acc, p) => acc + p.removeCount, 0);
  const totalKeep = plan.reduce((acc, p) => acc + p.keep, 0);

  console.log(`[SeedReduction] Affected people: ${plan.length}`);
  console.log(`[SeedReduction] Planned delete: ${totalRemove}, keep: ${totalKeep}`);
  console.log("[SeedReduction] Top 10 by current seed votes:");
  for (const p of plan.slice(0, 10)) {
    console.log(`  - ${p.personId}: ${p.current} -> ${p.keep} (delete ${p.removeCount})`);
  }

  if (!apply) {
    console.log("[SeedReduction] Dry-run complete. Re-run with --apply to execute.");
    return;
  }

  let deletedTotal = 0;
  let recomputed = 0;

  for (const p of plan) {
    if (p.removeCount <= 0) continue;
    const deleteIds = p.ids.slice(0, p.removeCount);
    const { error } = await supabaseServer
      .from("user_votes")
      .delete()
      .in("id", deleteIds);

    if (error) {
      throw new Error(`Failed deleting seed votes for ${p.personId}: ${error.message}`);
    }

    deletedTotal += deleteIds.length;
    await recomputeApprovalMetrics(p.personId);
    recomputed += 1;
  }

  console.log(`[SeedReduction] Deleted ${deletedTotal} seeded votes`);
  console.log(`[SeedReduction] Recomputed metrics for ${recomputed} people`);
  console.log("[SeedReduction] Apply complete.");
}

main().catch((error) => {
  console.error("[SeedReduction] Failed:", error);
  process.exit(1);
});

