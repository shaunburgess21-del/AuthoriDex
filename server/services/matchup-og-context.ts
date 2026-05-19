import { db } from "../db";
import { trackedPeople } from "@shared/schema";
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
  );
  const optB = resolveMatchupOptionDisplay(
    matchup.optionBImage,
    matchup.personBId,
    matchup.optionBText,
    matchup.optionAText,
    matchup.optionBText,
    avatarById,
    avatarByName,
  );

  return {
    slug: matchup.slug,
    title: matchup.title,
    promptText: matchup.promptText,
    optionAText: matchup.optionAText,
    optionBText: matchup.optionBText,
    category: matchup.category,
    optionAImageUrl: pickMatchupImageUrl(optA),
    optionBImageUrl: pickMatchupImageUrl(optB),
  };
}
