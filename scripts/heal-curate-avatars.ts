#!/usr/bin/env npx tsx
/**
 * One-off heal: re-run syncWinningAvatarForPerson for every tracked person
 * so that `tracked_people.avatar` and `trending_people.avatar` are realigned
 * to the live curate winner from `celebrity_images`.
 *
 * Use this once after deploying the curate avatar consistency fix to repair
 * any rows that drifted while the admin sync paths were uneven. Safe to run
 * repeatedly; idempotent when no new curate votes have changed the winner.
 *
 * Usage:
 *   npx tsx scripts/heal-curate-avatars.ts             # apply (default)
 *   npx tsx scripts/heal-curate-avatars.ts --dry-run   # report drift only, no writes
 *
 * Requires DATABASE_URL / Supabase env like the main server.
 */

import { eq, asc, desc } from "drizzle-orm";
import { db } from "../server/db";
import { celebrityImages, trackedPeople, trendingPeople } from "@shared/schema";
import { syncWinningAvatarForPerson } from "../server/lib/curateAvatar";

const DRY_RUN = process.argv.includes("--dry-run");

type DriftKind = "tracked_only" | "trending_only" | "tracked_vs_trending" | "winner_vs_denorm";

interface DriftRow {
  personId: string;
  name: string | null;
  kind: DriftKind;
  trackedAvatar: string | null;
  trendingAvatar: string | null;
  winningImageUrl: string | null;
}

async function main() {
  console.log(`[Heal] starting curate avatar heal (${DRY_RUN ? "DRY RUN" : "APPLY"})`);

  const people = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
      trackedAvatar: trackedPeople.avatar,
    })
    .from(trackedPeople);

  console.log(`[Heal] scanning ${people.length} tracked people`);

  const drifts: DriftRow[] = [];
  let synced = 0;
  let errors = 0;

  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    try {
      const [trendingRow] = await db
        .select({ avatar: trendingPeople.avatar })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, p.id))
        .limit(1);
      const trendingAvatar = trendingRow?.avatar ?? null;

      const [topImage] = await db
        .select({ imageUrl: celebrityImages.imageUrl, votesUp: celebrityImages.votesUp })
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, p.id))
        .orderBy(desc(celebrityImages.votesUp), asc(celebrityImages.addedAt))
        .limit(1);
      const winningImageUrl = topImage?.imageUrl ?? null;

      let kind: DriftKind | null = null;
      if (p.trackedAvatar && !trendingAvatar) kind = "tracked_only";
      else if (!p.trackedAvatar && trendingAvatar) kind = "trending_only";
      else if (p.trackedAvatar !== trendingAvatar) kind = "tracked_vs_trending";
      else if (winningImageUrl && p.trackedAvatar !== winningImageUrl) kind = "winner_vs_denorm";

      if (kind) {
        drifts.push({
          personId: p.id,
          name: p.name,
          kind,
          trackedAvatar: p.trackedAvatar ?? null,
          trendingAvatar,
          winningImageUrl,
        });
      }

      if (!DRY_RUN) {
        await syncWinningAvatarForPerson(p.id);
        synced++;
      }
    } catch (err: any) {
      errors++;
      console.error(`[Heal] error on ${p.id} (${p.name}): ${err?.message || err}`);
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[Heal] progress ${i + 1}/${people.length} (drifts so far: ${drifts.length})`);
    }
  }

  console.log("");
  console.log(`[Heal] total scanned:   ${people.length}`);
  console.log(`[Heal] drift detected:  ${drifts.length}`);
  console.log(`[Heal] synced:          ${synced}${DRY_RUN ? " (skipped, dry-run)" : ""}`);
  console.log(`[Heal] errors:          ${errors}`);

  if (drifts.length > 0) {
    const byKind = drifts.reduce<Record<string, number>>((acc, d) => {
      acc[d.kind] = (acc[d.kind] ?? 0) + 1;
      return acc;
    }, {});
    console.log("[Heal] drift breakdown:");
    for (const [kind, count] of Object.entries(byKind)) {
      console.log(`        ${kind}: ${count}`);
    }
    console.log("[Heal] sample drifts (up to 10):");
    for (const d of drifts.slice(0, 10)) {
      console.log(
        `        ${d.name ?? d.personId} [${d.kind}]\n` +
        `          tracked : ${d.trackedAvatar ?? "(null)"}\n` +
        `          trending: ${d.trendingAvatar ?? "(null)"}\n` +
        `          winner  : ${d.winningImageUrl ?? "(null)"}`
      );
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[Heal] fatal error:", err);
  process.exit(1);
});
