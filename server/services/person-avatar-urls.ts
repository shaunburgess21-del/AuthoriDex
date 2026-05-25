/** Resolve celebrity profile image URLs (no DB). Mirrors client imageResolver tile/expanded. */

const CELEBRITY_BUCKET = "celebrity-large";

function supabasePublicBase(): string | null {
  if (!process.env.SUPABASE_URL) return null;
  return `${process.env.SUPABASE_URL}/storage/v1/object/public`;
}

export function personConventionImageUrl(
  imageSlug: string | null | undefined,
  index: number = 1,
): string | null {
  if (!imageSlug) return null;
  const base = supabasePublicBase();
  if (!base) return null;
  const seg = encodeURIComponent(imageSlug);
  return `${base}/${CELEBRITY_BUCKET}/${seg}/${index}.webp`;
}

export function resolvePersonAvatarUrl(
  storedAvatar: string | null | undefined,
  imageSlug: string | null | undefined,
): string | null {
  const candidates = resolvePersonAvatarCandidates(storedAvatar, imageSlug);
  return candidates[0] ?? null;
}

/** Ordered URLs to try when fetching hero photo (stored avatar, then 1–4.webp, legacy png). */
export function resolvePersonAvatarCandidates(
  storedAvatar: string | null | undefined,
  imageSlug: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (url: string | null | undefined) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    const trimmed = url.trim();
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(trimmed);
  };

  push(storedAvatar ?? null);

  if (imageSlug) {
    for (let i = 1; i <= 4; i++) {
      push(personConventionImageUrl(imageSlug, i));
    }
    const base = supabasePublicBase();
    if (base) {
      push(`${base}/celebrity_images/${encodeURIComponent(imageSlug)}/1.png`);
    }
  }

  return out;
}
