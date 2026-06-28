/** Resolve opinion poll hero and option image URLs (same rules as GET /api/opinion-polls). */

export function slugifyOptionName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Known compound tokens where storage uses an extra hyphen (e.g. star-fish). */
const COMPOUND_SLUG_FIXES: Array<[RegExp, string]> = [
  [/starfish/g, "star-fish"],
];

function applyCompoundSlugFixes(slug: string): string {
  let result = slug;
  for (const [pattern, replacement] of COMPOUND_SLUG_FIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Storage filenames for options like "X (Twitter)" use the short label (`x.webp`),
 * not the full clarifier slug (`x-twitter.webp`). Prefer the short form when the
 * primary label is very brief and the full slug adds a parenthetical suffix.
 */
export function preferredOptionSlug(name: string): string {
  const full = slugifyOptionName(name);
  const parenIdx = name.indexOf("(");
  if (parenIdx > 0) {
    const before = slugifyOptionName(name.slice(0, parenIdx));
    if (before && before.length <= 2 && full.startsWith(`${before}-`)) {
      return applyCompoundSlugFixes(before);
    }
  }
  return applyCompoundSlugFixes(full);
}

function opinionPollBucketBase(): string | null {
  if (!process.env.SUPABASE_URL) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public/opinion-polls`;
}

export function opinionPollConventionImageUrl(
  pollSlug: string | null | undefined,
): string | null {
  if (!pollSlug) return null;
  const base = opinionPollBucketBase();
  if (!base) return null;
  return `${base}/${pollSlug}/1.webp`;
}

function opinionOptionConventionImageUrl(
  pollSlug: string | null | undefined,
  optionName: string,
): string | null {
  if (!pollSlug) return null;
  const base = opinionPollBucketBase();
  if (!base) return null;
  return `${base}/${pollSlug}/${preferredOptionSlug(optionName)}.webp`;
}

function isOpinionPollConventionImageUrl(url: string | null): boolean {
  return url != null && url.includes("/opinion-polls/") && url.endsWith("/1.webp");
}

export function resolveOpinionPollImageUrl(
  stored: string | null,
  pollSlug: string | null | undefined,
): string | null {
  const derived = opinionPollConventionImageUrl(pollSlug);
  if (!stored) return derived;
  if (!pollSlug) return stored;
  if (isOpinionPollConventionImageUrl(stored)) {
    try {
      if (!new URL(stored).pathname.includes(`/opinion-polls/${pollSlug}/`)) {
        return derived;
      }
    } catch {
      /* keep stored */
    }
  }
  return stored;
}

export function resolveOpinionOptionImageUrl(
  stored: string | null,
  pollSlug: string | null | undefined,
  optionName: string,
): string | null {
  const derived = opinionOptionConventionImageUrl(pollSlug, optionName);
  if (!stored) return derived;
  if (!pollSlug) return stored;
  if (stored.includes("/opinion-polls/")) {
    try {
      const path = new URL(stored).pathname;
      const optionSlug = preferredOptionSlug(optionName);
      if (!path.includes(`/opinion-polls/${pollSlug}/`)) return derived;
      if (stored.endsWith("/1.webp")) return derived;
      if (!path.endsWith(`/${optionSlug}.webp`)) return derived;
    } catch {
      /* keep stored */
    }
  }
  return stored;
}

export function resolveOpinionOptionDisplayImageUrl(
  personAvatar: string | null | undefined,
  stored: string | null,
  pollSlug: string | null | undefined,
  optionName: string,
): string | null {
  return (
    personAvatar ||
    resolveOpinionOptionImageUrl(stored, pollSlug, optionName)
  );
}
