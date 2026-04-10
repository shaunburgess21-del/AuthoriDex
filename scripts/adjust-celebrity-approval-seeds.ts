#!/usr/bin/env npx tsx
/**
 * One-off: scale existing approval seed votes to ~60% of current total (40% reduction)
 * using largest-remainder allocation to preserve each celebrity's seed-only average.
 *
 * Celebrities with zero seed votes get a random baseline: total votes in [30, 200],
 * implied average in [4.5, 4.9] (via target sum S clamped to [ceil(4.5T), floor(4.9T)]).
 *
 * Usage:
 *   npx tsx scripts/adjust-celebrity-approval-seeds.ts              # dry-run
 *   npx tsx scripts/adjust-celebrity-approval-seeds.ts --apply    # write
 *   npx tsx scripts/adjust-celebrity-approval-seeds.ts --rng-seed=12345
 *   npx tsx scripts/adjust-celebrity-approval-seeds.ts --status=main_leaderboard
 *
 * Requires DATABASE_URL / Supabase env like the main server. Not idempotent: do not run --apply twice.
 */

import { db } from "../server/db";
import { trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { ApprovalSeedCounts } from "../server/services/seed-approval-breakdown";
import {
  getSeedApprovalCounts,
  impliedAvgRating,
  replaceSeedApprovalBreakdown,
} from "../server/services/seed-approval-breakdown";

const KEYS: (keyof ApprovalSeedCounts)[] = ["1", "2", "3", "4", "5"];

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((x) => x.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Deterministic 0..1 PRNG (mulberry32). */
function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalVotes(c: ApprovalSeedCounts): number {
  return KEYS.reduce((sum, k) => sum + c[k], 0);
}

/**
 * New total = round(T_old * 0.6) — 40% reduction of seed count.
 * Allocate integer buckets via Hamilton / largest remainder.
 */
function allocateProportionalToTotal(old: ApprovalSeedCounts, targetTotal: number): ApprovalSeedCounts {
  const T_old = totalVotes(old);
  if (targetTotal <= 0 || T_old === 0) {
    return { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  }
  const floors: number[] = [];
  const fracs: number[] = [];
  for (const k of KEYS) {
    const q = (old[k] / T_old) * targetTotal;
    const fl = Math.floor(q);
    floors.push(fl);
    fracs.push(q - fl);
  }
  let rem = targetTotal - floors.reduce((a, b) => a + b, 0);
  const order = [0, 1, 2, 3, 4].sort((a, b) => fracs[b] - fracs[a]);
  const out = [...floors];
  for (let i = 0; i < rem; i++) {
    out[order[i]]++;
  }
  return { "1": out[0], "2": out[1], "3": out[2], "4": out[3], "5": out[4] };
}

/** T votes, sum of ratings = S, each rating 1..5 (E = S - T bonus points 0..4 per vote). */
function randomCountsFromTotalAndSum(rng: () => number, T: number, S: number): ApprovalSeedCounts | null {
  const E = S - T;
  if (E < 0 || E > 4 * T) return null;
  const bonus = new Array(T).fill(0);
  for (let left = E; left > 0; left--) {
    const candidates: number[] = [];
    for (let i = 0; i < T; i++) {
      if (bonus[i] < 4) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(rng() * candidates.length)];
    bonus[pick]++;
  }
  const counts: ApprovalSeedCounts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const b of bonus) {
    const r = 1 + b;
    counts[String(r) as keyof ApprovalSeedCounts]++;
  }
  return counts;
}

function generateRandomBaseline(rng: () => number): ApprovalSeedCounts {
  for (let attempt = 0; attempt < 8000; attempt++) {
    const T = 30 + Math.floor(rng() * (200 - 30 + 1));
    const A = 4.5 + rng() * 0.4;
    let S = Math.round(A * T);
    const sMin = Math.ceil(4.5 * T);
    const sMax = Math.floor(4.9 * T);
    if (sMin > sMax) continue;
    S = Math.max(sMin, Math.min(sMax, S));
    const c = randomCountsFromTotalAndSum(rng, T, S);
    if (!c) continue;
    const avg = impliedAvgRating(c);
    if (avg != null && avg >= 4.5 - 1e-9 && avg <= 4.9 + 1e-9) return c;
  }
  throw new Error("Failed to generate random baseline (increase attempts or check constraints)");
}

async function main() {
  const apply = hasFlag("apply");
  const statusFilter = parseArg("status");
  const seedStr = parseArg("rng-seed");
  const rngSeed = seedStr !== undefined ? parseInt(seedStr, 10) : Date.now();
  if (!Number.isFinite(rngSeed)) {
    console.error("Invalid --rng-seed");
    process.exit(1);
  }
  const rng = createRng(rngSeed);

  console.log(`[adjust-approval-seeds] Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[adjust-approval-seeds] rng-seed: ${rngSeed}`);
  if (statusFilter) console.log(`[adjust-approval-seeds] status filter: ${statusFilter}`);

  const people = statusFilter
    ? await db
        .select({ id: trackedPeople.id, name: trackedPeople.name })
        .from(trackedPeople)
        .where(eq(trackedPeople.status, statusFilter))
    : await db.select({ id: trackedPeople.id, name: trackedPeople.name }).from(trackedPeople);

  console.log(`[adjust-approval-seeds] Celebrities to process: ${people.length}`);

  let branchScale = 0;
  let branchRandom = 0;

  for (const p of people) {
    const current = await getSeedApprovalCounts(p.id);
    const T_old = totalVotes(current);
    const oldAvg = impliedAvgRating(current);

    if (T_old > 0) {
      branchScale++;
      const T_new = Math.max(0, Math.round(T_old * 0.6));
      const next = allocateProportionalToTotal(current, T_new);
      const newAvg = impliedAvgRating(next);
      console.log(
        `[scale] ${p.name} (${p.id.slice(0, 8)}…) T ${T_old}→${T_new} avg ${oldAvg?.toFixed(3) ?? "?"}→${newAvg?.toFixed(3) ?? "n/a"}`,
      );
      if (apply) {
        await replaceSeedApprovalBreakdown({
          personId: p.id,
          personName: p.name,
          counts: next,
        });
      }
    } else {
      branchRandom++;
      const next = generateRandomBaseline(rng);
      const Tn = totalVotes(next);
      const nav = impliedAvgRating(next);
      console.log(
        `[random] ${p.name} (${p.id.slice(0, 8)}…) T=${Tn} avg=${nav?.toFixed(3)} counts=${JSON.stringify(next)}`,
      );
      if (apply) {
        await replaceSeedApprovalBreakdown({
          personId: p.id,
          personName: p.name,
          counts: next,
        });
      }
    }
  }

  console.log(`[adjust-approval-seeds] Summary: scaled=${branchScale}, random=${branchRandom}`);
  if (!apply) {
    console.log("[adjust-approval-seeds] Dry-run complete. Re-run with --apply to execute.");
  } else {
    console.log("[adjust-approval-seeds] Apply complete.");
  }
}

main().catch((e) => {
  console.error("[adjust-approval-seeds] Failed:", e);
  process.exit(1);
});
