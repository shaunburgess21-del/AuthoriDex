/** Resolve opinion poll hero image URLs (same rules as GET /api/opinion-polls). */

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
