import type { InductionCandidate, TrackedPerson } from "@shared/schema";

export function isEmptyish(v: string | null | undefined): boolean {
  return v == null || String(v).trim() === "";
}

/**
 * Build empty-only backfill updates from an induction candidate onto a tracked_people row.
 * When promoteToMainLeaderboard is true (approve flow), also sets status to main_leaderboard.
 */
export function buildTrackedPersonBackfillFromCandidate(
  tp: TrackedPerson,
  candidate: InductionCandidate,
  options: { promoteToMainLeaderboard?: boolean } = {},
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  if (options.promoteToMainLeaderboard && tp.status !== "main_leaderboard") {
    updates.status = "main_leaderboard";
  }

  // Prefer existing tracked slug when set (e.g. demoted main-board celebs with
  // celebrity_images / storage under tp.imageSlug). Only fill from candidate
  // when tracked has no slug.
  if (isEmptyish(tp.imageSlug) && !isEmptyish(candidate.imageSlug)) {
    updates.imageSlug = candidate.imageSlug;
  }

  if (
    tp.status === "induction" &&
    candidate.category &&
    candidate.category !== tp.category
  ) {
    updates.category = candidate.category;
  }

  if (isEmptyish(tp.wikiSlug) && !isEmptyish(candidate.wikiSlug)) {
    updates.wikiSlug = candidate.wikiSlug;
  }
  if (isEmptyish(tp.xHandle) && !isEmptyish(candidate.xHandle)) {
    updates.xHandle = candidate.xHandle;
  }
  if (isEmptyish(tp.instagramHandle) && !isEmptyish(candidate.instagramHandle)) {
    updates.instagramHandle = candidate.instagramHandle;
  }
  if (isEmptyish(tp.tiktokHandle) && !isEmptyish(candidate.tiktokHandle)) {
    updates.tiktokHandle = candidate.tiktokHandle;
  }
  if (isEmptyish(tp.youtubeId) && !isEmptyish(candidate.youtubeId)) {
    updates.youtubeId = candidate.youtubeId;
  }
  if (isEmptyish(tp.spotifyId) && !isEmptyish(candidate.spotifyId)) {
    updates.spotifyId = candidate.spotifyId;
  }
  if (isEmptyish(tp.searchQueryOverride) && !isEmptyish(candidate.searchQueryOverride)) {
    updates.searchQueryOverride = candidate.searchQueryOverride;
  }
  if (isEmptyish(tp.googleTrendsTopicId) && !isEmptyish(candidate.googleTrendsTopicId)) {
    updates.googleTrendsTopicId = candidate.googleTrendsTopicId;
  }

  return updates;
}
