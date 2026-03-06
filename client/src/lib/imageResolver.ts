import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

const CELEBRITY_BUCKET = "celebrity-large";
const LEADERS_BUCKET = "leaders-large";

export type ImageContext = "tile" | "expanded" | "induction";

/**
 * Returns candidate image URLs for a given slug and context.
 * All images now use a single bucket per source (celebrity-large for leaderboard/profile,
 * leaders-large for induction queue). No subfolders — files sit at [bucket]/[slug]/[filename].webp
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
