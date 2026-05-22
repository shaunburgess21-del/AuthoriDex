/** Resolve celebrity profile image URLs for OG (mirrors client imageResolver tile/expanded). */

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
  if (storedAvatar && /^https?:\/\//i.test(storedAvatar.trim())) {
    return storedAvatar.trim();
  }
  return personConventionImageUrl(imageSlug, 1);
}
