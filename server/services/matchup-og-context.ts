import { and, count, eq } from "drizzle-orm";
import { db } from "../db";
import { trackedPeople, votes } from "@shared/schema";
import { resolvePublicMatchupBySlugOrId } from "../utils/matchup-resolve";
import {
  pickMatchupImageUrl,
  resolveMatchupOptionDisplay,
} from "./matchup-option-images";

export {
  matchupOgDescription,
  matchupOgPromptTitle,
} from "./matchup-og-meta";

export interface MatchupOgContext {
  slug: string;
  title: string;
  promptText: string | null;
  optionAText: string;
  optionBText: string;
  category: string;
  optionAImageUrl: string | null;
  optionBImageUrl: string | null;
  visibleCountries: string[];
  /** Null or omitted when nobody has voted yet — the card omits a fake 50/50. */
  optionAPercent?: number | null;
  optionBPercent?: number | null;
  neutralPercent?: number | null;
  totalVotes?: number;
}

/**
 * Load a public matchup row plus resolved option image URLs (same rules
 * as GET /api/matchups/by-slug/:slug).
 */
export async function loadMatchupOgContext(
  rawSlug: string,
): Promise<MatchupOgContext | null> {
  const matchup = await resolvePublicMatchupBySlugOrId(rawSlug);
  if (!matchup || !matchup.slug) return null;

  // Same avatar maps as GET /api/matchups/by-slug/:slug (full name index).
  const celebrities = await db
    .select({
      id: trackedPeople.id,
      name: trackedPeople.name,
      avatar: trackedPeople.avatar,
    })
    .from(trackedPeople);

  const avatarByName: Record<string, string | null> = {};
  const avatarById: Record<string, string | null> = {};
  for (const celeb of celebrities) {
    avatarByName[celeb.name.toLowerCase()] = celeb.avatar;
    avatarById[celeb.id] = celeb.avatar;
  }

  const optA = resolveMatchupOptionDisplay(
    matchup.optionAImage,
    matchup.personAId,
    matchup.optionAText,
    matchup.optionAText,
    matchup.optionBText,
    avatarById,
    avatarByName,
    matchup.slug,
  );
  const optB = resolveMatchupOptionDisplay(
    matchup.optionBImage,
    matchup.personBId,
    matchup.optionBText,
    matchup.optionAText,
    matchup.optionBText,
    avatarById,
    avatarByName,
    matchup.slug,
  );

  const tally = await loadMatchupVoteTally(matchup.id, {
    seedA: matchup.seedVotesA || 0,
    seedB: matchup.seedVotesB || 0,
    seedNeutral: matchup.seedVotesNeutral || 0,
  });

  return {
    slug: matchup.slug,
    title: matchup.title,
    promptText: matchup.promptText,
    optionAText: matchup.optionAText,
    optionBText: matchup.optionBText,
    category: matchup.category,
    optionAImageUrl: pickMatchupImageUrl(optA),
    optionBImageUrl: pickMatchupImageUrl(optB),
    visibleCountries: matchup.visibleCountries ?? [],
    optionAPercent: tally.optionAPercent,
    optionBPercent: tally.optionBPercent,
    neutralPercent: tally.neutralPercent,
    totalVotes: tally.totalVotes,
  };
}

/**
 * Same display totals as GET /api/matchups: real face_off votes plus seeds.
 * Percents stay null at zero votes so the share image does not invent a tie.
 */
async function loadMatchupVoteTally(
  matchupId: string,
  seed: { seedA: number; seedB: number; seedNeutral: number },
): Promise<{
  optionAPercent: number | null;
  optionBPercent: number | null;
  neutralPercent: number | null;
  totalVotes: number;
}> {
  const rows = await db
    .select({ value: votes.value, cnt: count() })
    .from(votes)
    .where(and(eq(votes.voteType, "face_off"), eq(votes.targetId, matchupId)))
    .groupBy(votes.value);

  let realA = 0;
  let realB = 0;
  let realNeutral = 0;
  for (const row of rows) {
    const n = Number(row.cnt) || 0;
    if (row.value === "option_a") realA = n;
    else if (row.value === "option_b") realB = n;
    else if (row.value === "neutral") realNeutral = n;
  }

  const displayA = realA + seed.seedA;
  const displayB = realB + seed.seedB;
  const displayNeutral = realNeutral + seed.seedNeutral;
  const totalVotes = displayA + displayB + displayNeutral;
  if (totalVotes <= 0) {
    return {
      optionAPercent: null,
      optionBPercent: null,
      neutralPercent: null,
      totalVotes: 0,
    };
  }
  const optionAPercent = Math.round((displayA / totalVotes) * 100);
  const optionBPercent = Math.round((displayB / totalVotes) * 100);
  return {
    optionAPercent,
    optionBPercent,
    neutralPercent: 100 - optionAPercent - optionBPercent,
    totalVotes,
  };
}
