/**
 * Opinion poll OG share image cache bust — keep server meta and client meta in sync.
 * v3: canonical card is the existing 1200×630 PNG. The .jpg route stays for old links.
 */
export const OPINION_POLL_OG_IMAGE_VERSION = "3";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function opinionPollOgImagePath(slug: string): string {
  return `/api/og/vote/opinion-polls/${encodeURIComponent(slug)}.png?v=${OPINION_POLL_OG_IMAGE_VERSION}`;
}

export function opinionDocumentDescription(input: {
  summary?: string | null;
  description?: string | null;
  leaderName?: string | null;
  leaderPercent?: number | null;
  totalVotes?: number | null;
}): string {
  const text = (input.summary || input.description || "").trim();
  const base = text || "Cast your vote on VoxDex.";
  const votes = input.totalVotes ?? 0;
  const percent = input.leaderPercent ?? 0;
  const name = input.leaderName?.trim();
  if (votes <= 0 || !name || percent <= 0) return base;
  return `${base} ${name} leads at ${percent}%.`;
}
