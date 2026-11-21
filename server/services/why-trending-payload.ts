import { createHash } from "crypto";

/**
 * Empty Why Trending body. The profile card already renders this when
 * `hasContext` is false. Used when news rows or the model payload are missing
 * so the route does not have to answer 500.
 */
export function emptyWhyTrendingPayload(personId: string, personName: string) {
  return {
    personId,
    personName,
    hasContext: false as const,
    cacheStatus: "NO_NEWS" as const,
    staleAgeMinutes: null,
    message: "No recent trending context available",
    fetchedAt: new Date(),
  };
}

export function extractHeadlineDomain(url: string | null | undefined): string {
  if (typeof url !== "string" || !url) return "unknown";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

export function normalizeHeadlineTitle(title: string | null | undefined): string {
  if (!title) return "";
  let t = title;
  t = t.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
  t = t.replace(/\s*[-–—|]\s*(CNN|Reuters|AP|BBC|NBC|CBS|ABC|Fox News|CNBC|Bloomberg|Forbes|WSJ|The Guardian|The New York Times|Associated Press|NPR|USA Today|The Washington Post|Sky News|Al Jazeera|MSNBC|The Hill|Politico|TechCrunch|The Verge|Variety|TMZ|E! News|People|Entertainment Weekly|ESPN|Daily Mail|NY Post|New York Post|Axios|Business Insider|The Independent)\.?$/i, "");
  t = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return t;
}

/** Hash top-3 headlines only — more stable than the full Serper list. */
export function computeHeadlineHash(
  sources: Array<{ title?: string | null; link?: string | null }>,
): string {
  const top = sources.slice(0, 3);
  const stableIds = top.map((s) => {
    const domain = s.link ? extractHeadlineDomain(s.link) : "unknown";
    return `${domain}|${normalizeHeadlineTitle(s.title)}`;
  });
  return createHash("sha256").update(stableIds.sort().join("||")).digest("hex").slice(0, 16);
}

/**
 * Model output for a Why Trending summary. A missing, fenced, or truncated
 * body falls back to the headline instead of throwing — that throw was what
 * the route turned into HTTP 500.
 */
export function parseWhyTrendingModelContent(
  content: string | null | undefined,
  fallback: { summary: string; category: string },
): { summary: string; category: string } {
  const trimmed = content?.trim();
  if (!trimmed) return fallback;
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const raw = JSON.parse(unfenced) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
    const record = raw as { summary?: unknown; category?: unknown };
    const summary = typeof record.summary === "string" && record.summary.trim()
      ? record.summary.trim()
      : fallback.summary;
    const category = typeof record.category === "string" && record.category.trim()
      ? record.category.trim()
      : fallback.category;
    return { summary, category };
  } catch {
    return fallback;
  }
}
