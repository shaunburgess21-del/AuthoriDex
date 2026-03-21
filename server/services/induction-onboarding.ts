import { randomUUID } from "crypto";
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
  ensureUpDownMarketForInductee,
} from "../jobs/market-generator";

const BASELINE_RUN_ID = "induction-onboard";

function publicCelebrityLargeImageUrl(imageSlug: string | null | undefined): string | null {
  const base = process.env.SUPABASE_URL;
  if (!base || !imageSlug?.trim()) return null;
  return `${base}/storage/v1/object/public/celebrity-large/${encodeURIComponent(imageSlug.trim())}/1.webp`;
}

/**
 * After admin approves an induction candidate: leaderboard rows, baseline trend data,
 * curate images, weekly Up/Down market, gainer backfill, value metrics for O/U deck.
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

    await db
      .insert(trendingPeople)
      .values({
        id: personId,
        name: tp.name,
        category: tp.category,
        rank: 999,
        trendScore: 0,
        fameIndex: 0,
      })
      .onConflictDoNothing();

    const [hasSnap] = await db
      .select({ id: trendSnapshots.id })
      .from(trendSnapshots)
      .where(eq(trendSnapshots.personId, personId))
      .limit(1);

    if (!hasSnap) {
      const ts = new Date();
      await db.insert(trendSnapshots).values({
        id: randomUUID(),
        personId,
        timestamp: ts,
        newsCount: 0,
        youtubeViews: 0,
        spotifyFollowers: 0,
        searchVolume: 0,
        trendScore: 0,
        fameIndex: 0,
        runId: BASELINE_RUN_ID,
        snapshotOrigin: "induction_onboard",
      });
    }

    const heroUrl = publicCelebrityLargeImageUrl(imageSlug || tp.imageSlug);
    if (heroUrl) {
      const [hasImg] = await db
        .select({ id: celebrityImages.id })
        .from(celebrityImages)
        .where(eq(celebrityImages.personId, personId))
        .limit(1);
      if (!hasImg) {
        await db.insert(celebrityImages).values({
          personId,
          imageUrl: heroUrl,
          source: "induction",
          isPrimary: true,
        });
      }

      if (!tp.avatar) {
        await db
          .update(trackedPeople)
          .set({ avatar: heroUrl })
          .where(eq(trackedPeople.id, personId));
      }
    }

    await recomputeCelebrityMetrics(personId).catch((e) =>
      console.error("[induction-onboarding] recomputeCelebrityMetrics:", e),
    );

    const updown = await ensureUpDownMarketForInductee({
      id: personId,
      name: displayName,
      category,
    });
    if (updown === "failed") {
      console.warn("[induction-onboarding] Up/Down market not created for", personId);
    }

    const gainer = await backfillGainerMarketForInductee({
      id: personId,
      name: displayName,
      category,
      avatar: tp.avatar || heroUrl,
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
