/** Resolve opinion poll hero and option image URLs (same rules as GET /api/opinion-polls). */

export function slugifyOptionName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
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
  return `${base}/${pollSlug}/${slugifyOptionName(optionName)}.webp`;
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
      const optionSlug = slugifyOptionName(optionName);
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
