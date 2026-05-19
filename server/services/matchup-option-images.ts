/**
 * Shared matchup option image resolution.
 *
 * Used by the public matchups API and OG image generation so preview
 * thumbnails always match what the frontend shows on VersusCard /
 * MatchupDetailPage.
 */

function matchupBucketBase(): string | null {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl}/storage/v1/object/public/matchups`;
}

/** @deprecated Prefer `matchupBucketUrl`; reads `SUPABASE_URL` at call time. */
export function getMatchupBucketBase(): string | null {
  return matchupBucketBase();
}

export function slugifyMatchupName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function matchupBucketUrl(
  optionAText: string,
  optionBText: string,
  optionText: string,
): string | null {
  const base = matchupBucketBase();
  if (!base) return null;
  const folder = `${slugifyMatchupName(optionAText)}-vs-${slugifyMatchupName(optionBText)}`;
  return `${base}/${folder}/${slugifyMatchupName(optionText)}.webp`;
}

export type MatchupOptionDisplay = {
  resolved: string | null;
  fallback: string | null;
};

/** Primary image: explicit DB URL > linked celebrity avatar > convention bucket URL. */
export function resolveMatchupOptionDisplay(
  dbUrl: string | null,
  personId: string | null,
  optionLabelText: string,
  optionAText: string,
  optionBText: string,
  avatarById: Record<string, string | null>,
  avatarByName: Record<string, string | null>,
): MatchupOptionDisplay {
  const bucket = matchupBucketUrl(optionAText, optionBText, optionLabelText);
  const linkedAvatar = personId ? (avatarById[personId] ?? null) : null;
  const nameAvatar = avatarByName[optionLabelText.toLowerCase()] ?? null;

  const resolved = dbUrl || linkedAvatar || bucket || null;

  for (const cand of [linkedAvatar, nameAvatar, bucket]) {
    if (cand && cand !== resolved) {
      return { resolved, fallback: cand };
    }
  }
  return { resolved, fallback: null };
}

/** First URL that loads for OG compositing (resolved, then fallback). */
export function pickMatchupImageUrl(display: MatchupOptionDisplay): string | null {
  return display.resolved || display.fallback || null;
}
