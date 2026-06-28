import { useState, useCallback, useEffect, useMemo, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";

const CELEBRITY_BUCKET = "celebrity-large";
const LEADERS_BUCKET = "leaders-large";

export type ImageContext = "tile" | "expanded" | "induction";

/**
 * Returns candidate image URLs for a given slug and context.
 * Leaderboard/profile use celebrity-large. Induction tries celebrity-large first (same bucket after consolidation),
 * then leaders-large for legacy objects still in that bucket.
 */
function storagePathSegment(slug: string): string {
  return encodeURIComponent(slug);
}

export function getImageCandidates(
  supabaseUrl: string,
  slug: string,
  context: ImageContext,
  index: number = 1
): string[] {
  const base = `${supabaseUrl}/storage/v1/object/public`;
  const candidates: string[] = [];
  const seg = storagePathSegment(slug);

  if (context === "induction") {
    for (const n of [1, 2, 3, 4] as const) {
      candidates.push(`${base}/${CELEBRITY_BUCKET}/${seg}/${n}.webp`);
    }
    candidates.push(`${base}/${LEADERS_BUCKET}/${seg}/1.webp`);
    candidates.push(`${base}/${LEADERS_BUCKET}/${seg}/2.webp`);
  } else {
    // tile and expanded: same bucket and path
    candidates.push(`${base}/${CELEBRITY_BUCKET}/${seg}/${index}.webp`);
    if (index > 1) {
      candidates.push(`${base}/${CELEBRITY_BUCKET}/${seg}/1.webp`);
    }
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

export const IMG_EXTENSIONS = [".webp", ".jpeg", ".jpg", ".png"] as const;

/** Strip known image extension from URL path (ignores query string). */
export function stripImageExtension(url: string): string | null {
  const path = url.split("?")[0].toLowerCase();
  const ext = IMG_EXTENSIONS.find((e) => path.endsWith(e));
  if (!ext) return null;
  return url.slice(0, url.length - (path.length - path.lastIndexOf(ext)));
}

/** Ordered candidates: alternate extensions for `primary`, then optional `fallback`. */
export function buildImageLoadCandidates(
  primary: string,
  fallback?: string | null,
): string[] {
  const base = stripImageExtension(primary);
  const extensionVariants = base
    ? IMG_EXTENSIONS.map((ext) => base + ext)
    : [primary];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...extensionVariants, ...(fallback ? [fallback] : [])]) {
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

/**
 * React-safe image fallback for matchup cards. Cycles extensions then optional
 * fallback URL without imperative DOM mutation (survives parent re-renders).
 */
export function useMatchupImageCandidates(
  primary: string | null | undefined,
  fallback?: string | null,
): { src: string | null; onError: () => void; exhausted: boolean } {
  const candidates = useMemo(() => {
    if (!primary) return fallback ? [fallback] : [];
    return buildImageLoadCandidates(primary, fallback);
  }, [primary, fallback]);

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [primary, fallback]);

  const onError = useCallback(() => {
    setIndex((prev) => prev + 1);
  }, []);

  return {
    src: index < candidates.length ? candidates[index] : null,
    onError,
    exhausted: candidates.length > 0 && index >= candidates.length,
  };
}

/**
 * Generic onError handler for matchup / bucket-derived images.
 * Tries alternate extensions (.webp -> .jpeg -> .jpg -> .png),
 * then a fallback URL (e.g. celebrity avatar), then hides the element.
 *
 * Prefer `useMatchupImageCandidates` inside React components — imperative
 * `img.src` changes are reset when React re-renders controlled `src` props.
 */
export function handleImageError(
  e: SyntheticEvent<HTMLImageElement>,
  fallbackUrl?: string | null,
) {
  const img = e.currentTarget;
  const src = img.src;

  const base = stripImageExtension(src);
  if (base) {
    const path = src.split("?")[0].toLowerCase();
    const currentExt = IMG_EXTENSIONS.find((ext) => path.endsWith(ext));
    if (currentExt) {
      const nextIdx = IMG_EXTENSIONS.indexOf(currentExt) + 1;
      if (nextIdx < IMG_EXTENSIONS.length) {
        img.removeAttribute("srcset");
        img.src = base + IMG_EXTENSIONS[nextIdx];
        return;
      }
    }
  }

  if (fallbackUrl && !img.dataset.triedFallback) {
    img.dataset.triedFallback = "true";
    img.removeAttribute("srcset");
    img.src = fallbackUrl;
    return;
  }

  img.style.display = "none";
}
