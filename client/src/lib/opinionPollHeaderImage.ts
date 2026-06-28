import { useCallback, useEffect, useMemo, useState } from "react";

type OpinionPollOptionLike = {
  imageUrl?: string | null;
};

type OpinionPollLike = {
  imageUrl?: string | null;
  options?: OpinionPollOptionLike[] | null;
};

/** First option row with an http(s) image URL (matches detail page). */
export function getFirstOpinionPollOptionImageUrl(
  options: OpinionPollOptionLike[] | null | undefined,
): string | null {
  if (!Array.isArray(options)) return null;
  for (const o of options) {
    const url = o?.imageUrl?.trim();
    if (url && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

export function getOpinionPollConventionImageUrl(
  supabaseUrl: string | null | undefined,
  slug: string | null | undefined,
): string | null {
  if (!supabaseUrl?.trim() || !slug?.trim()) return null;
  return `${supabaseUrl.trim()}/storage/v1/object/public/opinion-polls/${slug.trim()}/1.webp`;
}

/** Ordered header image candidates: poll image → first option → bucket convention. */
export function getOpinionPollHeaderImageSources(
  poll: OpinionPollLike | null | undefined,
  slug: string | null | undefined,
  supabaseUrl: string | null | undefined,
): string[] {
  if (!poll) return [];
  const firstOptionImageUrl = getFirstOpinionPollOptionImageUrl(poll.options);
  const conventionPollImageUrl = getOpinionPollConventionImageUrl(supabaseUrl, slug);
  return [poll.imageUrl, firstOptionImageUrl, conventionPollImageUrl].filter(
    (url): url is string => !!url && /^https?:\/\//i.test(url),
  );
}

/** Cycles through header image sources on load error (card + detail). */
export function useOpinionPollHeaderImage(
  poll: OpinionPollLike | null | undefined,
  slug: string | null | undefined,
  supabaseUrl: string | null | undefined,
): { currentSrc: string | null; onImageError: () => void } {
  const sources = useMemo(
    () => getOpinionPollHeaderImageSources(poll, slug, supabaseUrl),
    [poll, slug, supabaseUrl, poll?.imageUrl, poll?.options],
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [slug, poll?.imageUrl, poll?.options, sources.join("|")]);

  const onImageError = useCallback(() => {
    setIndex((prev) => (prev + 1 < sources.length ? prev + 1 : sources.length));
  }, [sources.length]);

  const currentSrc = index < sources.length ? sources[index] : null;

  return { currentSrc, onImageError };
}
