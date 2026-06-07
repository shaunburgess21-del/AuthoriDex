import type { TrendingPerson } from "@shared/schema";
import { selectHotMovers } from "../trending/hot-movers";

export const BRIEFING_ANCHOR_COUNT = 3;
export const BRIEFING_MOVER_COUNT = 3;
export const BRIEFING_PREFETCH_MAX = 6;

const STORY_REFRESH_UTC_HOURS = [6, 18] as const;

export interface BriefingPersonInput {
  id: string;
  name: string;
  rank: number;
  change24h: number;
  category: string;
  whyTrending?: string;
  topHeadline?: string;
}

export interface BriefingInputs {
  anchors: BriefingPersonInput[];
  movers: BriefingPersonInput[];
  people: Array<{ id: string; name: string }>;
}

/**
 * The briefing prose is regenerated only twice daily, but the 24h leaderboard
 * churns hourly — so the copy must stay valid for ~12h. We keep it
 * number-light (no exact "+9.4%" that goes stale within an hour); the live
 * headline + mover strip on the client carry the current figures.
 */

/** Next 06:00 or 18:00 UTC refresh boundary (whichever is sooner). */
export function nextBriefingRefreshIso(from: Date = new Date()): string {
  const now = from;
  const candidates = STORY_REFRESH_UTC_HOURS.map((hour) => {
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  });
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0]!.toISOString();
}

/** Hot-mover top 3 — rank ≤ 100, positive 24h change (Why Trending coverage). */
export function selectBriefingMovers(people: TrendingPerson[]): TrendingPerson[] {
  return selectHotMovers(people).slice(0, BRIEFING_MOVER_COUNT);
}

/**
 * Ordered anchor candidates from top 10 by rank: movers excluded, prefer
 * outside hot-mover top 6, sort by news activity then rank. Caller walks this
 * list and keeps the first N with Why Trending `hasContext`.
 */
export function selectBriefingAnchorCandidates(
  people: TrendingPerson[],
  moverIds: Set<string>,
  hotMoverTop6Ids: Set<string>,
  newsCountByPersonId: Map<string, number>,
): TrendingPerson[] {
  const top10 = [...people]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, 10)
    .filter((p) => !moverIds.has(p.id));

  const newsCount = (id: string) => newsCountByPersonId.get(id) ?? 0;
  const sortByNewsThenRank = (a: TrendingPerson, b: TrendingPerson) => {
    const newsDiff = newsCount(b.id) - newsCount(a.id);
    if (newsDiff !== 0) return newsDiff;
    return (a.rank ?? 999) - (b.rank ?? 999);
  };

  const preferred = top10
    .filter((p) => !hotMoverTop6Ids.has(p.id))
    .sort(sortByNewsThenRank);

  const backfill = top10
    .filter((p) => hotMoverTop6Ids.has(p.id))
    .sort(sortByNewsThenRank);

  return [...preferred, ...backfill];
}

export function buildDeterministicHeadline(inputs: BriefingInputs): string {
  const lead = inputs.movers[0];
  return lead ? `${lead.name} leads today's movers` : "Today's influence snapshot";
}

function beatForPerson(person: BriefingPersonInput, fallback: string): string {
  if (person.whyTrending) return person.whyTrending;
  return fallback;
}

export function buildDeterministicParagraphs(inputs: BriefingInputs): string[] {
  const paragraphs: string[] = [];

  for (const anchor of inputs.anchors) {
    paragraphs.push(
      beatForPerson(anchor, `${anchor.name} is in the news across ${anchor.category}.`),
    );
  }

  for (const mover of inputs.movers) {
    paragraphs.push(
      beatForPerson(mover, `${mover.name} is climbing the leaderboard in ${mover.category}.`),
    );
  }

  if (paragraphs.length === 0) {
    paragraphs.push("The board is steady today with no standout stories to highlight.");
  }

  return paragraphs;
}
