import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

const CELEBRITY_SMALL_PREFIX = "_compressed_small_100kb_webp";
const CELEBRITY_LARGE_PREFIX = "_compressed_large_200kb_webp";
const LEADERS_SMALL_PREFIX = "_compressed_70kb";
const LEADERS_LARGE_PREFIX = "_compressed_150kb_expanded";

export type ImageContext = "tile" | "expanded";

export function getImageCandidates(
  supabaseUrl: string,
  slug: string,
  context: ImageContext,
  index: number = 1
): string[] {
  const base = `${supabaseUrl}/storage/v1/object/public`;
  const candidates: string[] = [];

  if (context === "tile") {
    candidates.push(`${base}/celebrity-small/${CELEBRITY_SMALL_PREFIX}/${slug}/${index}.webp`);
    candidates.push(`${base}/leaders-small/${LEADERS_SMALL_PREFIX}/${slug}/${index}.webp`);
    if (index > 1) {
      candidates.push(`${base}/celebrity-small/${CELEBRITY_SMALL_PREFIX}/${slug}/1.webp`);
      candidates.push(`${base}/leaders-small/${LEADERS_SMALL_PREFIX}/${slug}/1.webp`);
    }
    candidates.push(`${base}/celebrity_images/${slug}/1.png`);
  } else {
    candidates.push(`${base}/celebrity-large/${CELEBRITY_LARGE_PREFIX}/${slug}/${index}.webp`);
    candidates.push(`${base}/leaders-large/${LEADERS_LARGE_PREFIX}/${slug}/${index}.webp`);
    candidates.push(`${base}/celebrity-small/${CELEBRITY_SMALL_PREFIX}/${slug}/${index}.webp`);
    if (index > 1) {
      candidates.push(`${base}/celebrity-large/${CELEBRITY_LARGE_PREFIX}/${slug}/1.webp`);
      candidates.push(`${base}/leaders-large/${LEADERS_LARGE_PREFIX}/${slug}/1.webp`);
      candidates.push(`${base}/celebrity-small/${CELEBRITY_SMALL_PREFIX}/${slug}/1.webp`);
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
