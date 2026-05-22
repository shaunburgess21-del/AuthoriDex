import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  celebrityMetrics,
  celebrityProfiles,
  trackedPeople,
  trendingPeople,
} from "@shared/schema";
import {
  resolvePersonAvatarCandidates,
  resolvePersonAvatarUrl,
} from "./person-images";

export { personOgDescription } from "./person-og-meta";

export interface PersonOgContext {
  id: string;
  name: string;
  category: string;
  avatarUrl: string | null;
  imageSlug: string | null;
  avatarCandidates: string[];
  rank: number | null;
  trendScoreDisplay: string;
  change24h: number | null;
  change7d: number | null;
  approvalDisplay: string;
  shortBio: string | null;
  longBio: string | null;
  bio: string | null;
}

function formatTrendScore(fameIndex: number | null, trendScore: number): string {
  const display =
    fameIndex != null && fameIndex > 0
      ? fameIndex
      : Math.round(trendScore / 100);
  return display.toLocaleString("en-US");
}

function formatApproval(avg: number | null | undefined): string {
  if (avg == null || Number.isNaN(avg)) return "--";
  return `${avg.toFixed(1)}/5`;
}

export async function loadPersonOgContext(
  rawId: string,
): Promise<PersonOgContext | null> {
  const id = decodeURIComponent(rawId).trim();
  if (!id) return null;

  const [person] = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
      avatar: trendingPeople.avatar,
      bio: trendingPeople.bio,
      rank: trendingPeople.rank,
      trendScore: trendingPeople.trendScore,
      fameIndex: trendingPeople.fameIndex,
      change24h: trendingPeople.change24h,
      change7d: trendingPeople.change7d,
      category: trendingPeople.category,
    })
    .from(trendingPeople)
    .where(eq(trendingPeople.id, id))
    .limit(1);

  if (!person) return null;

  const [metrics, tracked, profile] = await Promise.all([
    db
      .select({ approvalAvgRating: celebrityMetrics.approvalAvgRating })
      .from(celebrityMetrics)
      .where(eq(celebrityMetrics.celebrityId, id))
      .limit(1),
    db
      .select({ imageSlug: trackedPeople.imageSlug })
      .from(trackedPeople)
      .where(eq(trackedPeople.id, id))
      .limit(1),
    db
      .select({
        shortBio: celebrityProfiles.shortBio,
        longBio: celebrityProfiles.longBio,
      })
      .from(celebrityProfiles)
      .where(eq(celebrityProfiles.personId, id))
      .limit(1),
  ]);

  const imageSlug = tracked[0]?.imageSlug ?? null;

  return {
    id: person.id,
    name: person.name,
    category: person.category || "Celebrity",
    avatarUrl: resolvePersonAvatarUrl(person.avatar, imageSlug),
    imageSlug,
    avatarCandidates: resolvePersonAvatarCandidates(person.avatar, imageSlug),
    rank: person.rank > 0 ? person.rank : null,
    trendScoreDisplay: formatTrendScore(person.fameIndex, person.trendScore),
    change24h: person.change24h,
    change7d: person.change7d,
    approvalDisplay: formatApproval(metrics[0]?.approvalAvgRating),
    shortBio: profile[0]?.shortBio ?? null,
    longBio: profile[0]?.longBio ?? null,
    bio: person.bio,
  };
}
