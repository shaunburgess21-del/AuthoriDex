import { randomUUID } from "crypto";
import { canonicalizePersonCategory } from "@shared/constants";
import { db } from "../db";
import {
  celebrityImages,
  trackedPeople,
  trendSnapshots,
  trendingPeople,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { recomputeCelebrityMetrics } from "./celebrity-metrics-recompute";
import {
  backfillGainerMarketForInductee,
} from "../jobs/market-generator";
import { supabaseServer } from "../supabase";
import { syncWinningAvatarForPerson } from "../lib/curateAvatar";
import { resolvePostInductionAvatar } from "./induction-avatar-resolution";

const BASELINE_RUN_ID = "induction-onboard";
const BUCKET = "celebrity-large";

function buildPublicUrl(slug: string, filename: string): string | null {
  const base = process.env.SUPABASE_URL;
  if (!base) return null;
  return `${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(slug)}/${filename}`;
}

/**
 * After admin approves an induction candidate: leaderboard rows, baseline trend data,
 * curate images, gainer backfill, value metrics for O/U deck.
 * Errors are logged; core induct should already have succeeded.
 */
export async function runPostInductionOnboarding(args: {
  personId: string;
  displayName: string;
  category: string;
  imageSlug: string | null;
}): Promise<void> {
  const { personId, displayName, category, imageSlug } = args;

  try {
    const [tp] = await db
      .select()
      .from(trackedPeople)
      .where(eq(trackedPeople.id, personId))
      .limit(1);
    if (!tp) {
      console.error("[induction-onboarding] No tracked person for", personId);
      return;
    }

    const slug = (imageSlug || tp.imageSlug || "").trim();
    let primaryUrl: string | null = null;

    const existingImages = await db
      .select({ imageUrl: celebrityImages.imageUrl, source: celebrityImages.source })
      .from(celebrityImages)
      .where(eq(celebrityImages.personId, personId));

    const hadCuratedImages = existingImages.length > 0;

    if (hadCuratedImages) {
      // CMS already curated celebrity_images; do not re-import staging slots from storage.
      await syncWinningAvatarForPerson(personId);
    } else if (slug) {
      const existingFilenames = new Set(
        existingImages
          .map((r) => {
            try { return new URL(r.imageUrl).pathname.split("/").pop(); } catch { return null; }
          })
          .filter(Boolean),
      );

      const { data: files, error: listError } = await supabaseServer.storage.from(BUCKET).list(slug);

      if (listError) {
        console.warn("[induction-onboarding] Supabase storage list error:", listError.message);
      }

      const imageFiles = (files || []).filter((f) => /\.(webp|jpg|jpeg|png)$/i.test(f.name));

      let insertedCount = 0;
      for (const file of imageFiles) {
        if (existingFilenames.has(file.name)) continue;
        const publicUrl = buildPublicUrl(slug, file.name);
        if (!publicUrl) continue;

        const isFirst = insertedCount === 0;
        await db.insert(celebrityImages).values({
          personId,
          imageUrl: publicUrl,
          source: "induction",
          isPrimary: isFirst,
        });
        if (isFirst) primaryUrl = publicUrl;
        insertedCount++;
      }

      if (insertedCount === 0) {
        const fallbackUrl = buildPublicUrl(slug, "1.webp");
        if (fallbackUrl) {
          await db.insert(celebrityImages).values({
            personId,
            imageUrl: fallbackUrl,
            source: "induction",
            isPrimary: true,
          });
          primaryUrl = fallbackUrl;
          insertedCount = 1;
        }
      }

      if (insertedCount > 0) {
        console.log(`[induction-onboarding] Synced ${insertedCount} image(s) for ${displayName} (slug: ${slug})`);
        await syncWinningAvatarForPerson(personId);
      }
    }

    const [refreshed] = await db
      .select({ avatar: trackedPeople.avatar })
      .from(trackedPeople)
      .where(eq(trackedPeople.id, personId))
      .limit(1);

    const resolvedAvatar = resolvePostInductionAvatar({
      hadCuratedImages,
      syncedAvatar: refreshed?.avatar ?? null,
      primaryUrl,
      slugFallbackUrl: hadCuratedImages ? null : buildPublicUrl(slug, "1.webp"),
    });

    if (resolvedAvatar && !refreshed?.avatar) {
      await db
        .update(trackedPeople)
        .set({ avatar: resolvedAvatar })
        .where(eq(trackedPeople.id, personId));
    }

    await db
      .insert(trendingPeople)
      .values({
        id: personId,
        name: tp.name,
        category: canonicalizePersonCategory(tp.category)!,
        avatar: resolvedAvatar,
        rank: 0,
        trendScore: 0,
        fameIndex: 0,
      })
      .onConflictDoUpdate({
        target: trendingPeople.id,
        set: {
          name: tp.name,
          category: canonicalizePersonCategory(tp.category)!,
          ...(resolvedAvatar ? { avatar: resolvedAvatar } : {}),
        },
      });

    const [hasSnap] = await db
      .select({ id: trendSnapshots.id })
      .from(trendSnapshots)
      .where(eq(trendSnapshots.personId, personId))
      .limit(1);

    if (!hasSnap) {
      // Bootstrap baseline snapshot into the official 'ingest' stream. Two DB
      // constraints must hold: chk_snapshot_origin_values (origin='ingest') and
      // chk_ingest_hour_truncated (timestamp on the hour) — otherwise the insert
      // throws and aborts the rest of onboarding (markets, metrics).
      //
      // Seed with the person's real current fame_index when present (e.g.
      // re-induction). Never write a synthetic 0 into the official stream: a 0
      // among real ~100k-800k values is a poison outlier that inflates 30-day
      // volatility (gainer-movement stddev) and skews opening-score medians.
      // For a brand-new inductee (fame_index still 0) we skip and let the first
      // real hourly ingest seed them.
      const [seed] = await db
        .select({
          fameIndex: trendingPeople.fameIndex,
          trendScore: trendingPeople.trendScore,
        })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, personId))
        .limit(1);

      const seedFame = seed?.fameIndex ?? 0;
      if (seedFame > 0) {
        const ts = new Date();
        ts.setUTCMinutes(0, 0, 0); // hour-truncate → satisfies chk_ingest_hour_truncated
        await db.insert(trendSnapshots).values({
          id: randomUUID(),
          personId,
          timestamp: ts,
          newsCount: 0,
          youtubeViews: 0,
          spotifyFollowers: 0,
          searchVolume: 0,
          trendScore: seed?.trendScore ?? seedFame,
          fameIndex: seedFame,
          runId: BASELINE_RUN_ID,
          snapshotOrigin: "ingest",
        })
          // Bulletproof: never let a unique(person_id, timestamp) collision with
          // an hourly-ingest row for this hour abort the rest of onboarding.
          .onConflictDoNothing();
      }
    }

    await recomputeCelebrityMetrics(personId).catch((e) =>
      console.error("[induction-onboarding] recomputeCelebrityMetrics:", e),
    );

    const gainer = await backfillGainerMarketForInductee({
      id: personId,
      name: displayName,
      category,
      avatar: resolvedAvatar,
    });
    if (gainer === "no_market") {
      console.log(
        `[induction-onboarding] No OPEN gainer for category ${category} this week; next generator run may add them.`,
      );
    }
  } catch (err) {
    console.error("[induction-onboarding] Error:", err);
  }
}
