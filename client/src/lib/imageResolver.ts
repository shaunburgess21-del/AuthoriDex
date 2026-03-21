import { useState, useCallback, useEffect, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";

const CELEBRITY_BUCKET = "celebrity-large";
const LEADERS_BUCKET = "leaders-large";

export type ImageContext = "tile" | "expanded" | "induction";

/**
 * Returns candidate image URLs for a given slug and context.
 * Leaderboard/profile use celebrity-large. Induction tries celebrity-large first (same bucket after consolidation),
 * then leaders-large for legacy objects still in that bucket.
 */
export function getImageCandidates(
  supabaseUrl: string,
  slug: string,
  context: ImageContext,
  index: number = 1
): string[] {
  const base = `${supabaseUrl}/storage/v1/object/public`;
  const candidates: string[] = [];

  if (context === "induction") {
    candidates.push(`${base}/${CELEBRITY_BUCKET}/${slug}/1.webp`);
    candidates.push(`${base}/${CELEBRITY_BUCKET}/${slug}/2.webp`);
    candidates.push(`${base}/${LEADERS_BUCKET}/${slug}/1.webp`);
    candidates.push(`${base}/${LEADERS_BUCKET}/${slug}/2.webp`);
    candidates.push(`${base}/celebrity_images/${slug}/1.png`);
  } else {
    // tile and expanded: same bucket and path
    candidates.push(`${base}/${CELEBRITY_BUCKET}/${slug}/${index}.webp`);
    if (index > 1) {
      candidates.push(`${base}/${CELEBRITY_BUCKET}/${slug}/1.webp`);
    }
    candidates.push(`${base}/celebrity_images/${slug}/1.png`);
  }

  return candidates;
}

export function useSupabaseUrl(): string | null {
  const { data } = useQuery<{ url: string }>({
    queryKey: ["/api/config/supabase"],
    staleTime: Infinity,
  });
  return data?.url ?? null;
}

export function useResolvedImage(
  slug: string | null | undefined,
  context: ImageContext = "tile",
  index: number = 1
): { src: string | null; onError: () => void } {
  const supabaseUrl = useSupabaseUrl();
  const [candidateIndex, setCandidateIndex] = useState(0);

  const candidates = slug && supabaseUrl
    ? getImageCandidates(supabaseUrl, slug, context, index)
    : [];

  useEffect(() => {
    setCandidateIndex(0);
  }, [slug, context, index, supabaseUrl]);

  const onError = useCallback(() => {
    setCandidateIndex((prev) => prev + 1);
  }, []);

  const src = candidateIndex < candidates.length ? candidates[candidateIndex] : null;

  return { src, onError };
}

const IMG_EXTENSIONS = ['.webp', '.jpeg', '.jpg', '.png'];

function stripExtension(url: string): string | null {
  const ext = IMG_EXTENSIONS.find(e => url.toLowerCase().endsWith(e));
  return ext ? url.slice(0, -ext.length) : null;
}

/**
 * Generic onError handler for matchup / bucket-derived images.
 * Tries alternate extensions (.webp -> .jpeg -> .jpg -> .png),
 * then a fallback URL (e.g. celebrity avatar), then hides the element.
 */
export function handleImageError(
  e: SyntheticEvent<HTMLImageElement>,
  fallbackUrl?: string | null,
) {
  const img = e.currentTarget;
  const src = img.src;

  const base = stripExtension(src);
  if (base) {
    const currentExt = IMG_EXTENSIONS.find(ext => src.toLowerCase().endsWith(ext))!;
    const nextIdx = IMG_EXTENSIONS.indexOf(currentExt) + 1;
    if (nextIdx < IMG_EXTENSIONS.length) {
      img.src = base + IMG_EXTENSIONS[nextIdx];
      return;
    }
  }

  if (fallbackUrl && !img.dataset.triedFallback) {
    img.dataset.triedFallback = 'true';
    img.src = fallbackUrl;
    return;
  }

  img.style.display = 'none';
}
