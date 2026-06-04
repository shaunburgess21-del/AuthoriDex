/**
 * Pure helpers for Serper News query building and post-fetch relevance filtering.
 */

const NEWS_MATCH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export interface SerperRelevanceSpec {
  /** Every token in each group must appear (AND across groups). */
  allOf: string[];
  /** At least one group must fully match (OR across groups). */
  anyOf: string[][];
}

export function buildSerperNewsQuery(
  personName: string,
  searchQueryOverride?: string | null,
): string {
  if (searchQueryOverride?.trim()) {
    return searchQueryOverride.trim();
  }

  const trimmed = personName.trim();
  if (!trimmed) return "";

  const parenMatch = trimmed.match(/\(([^)]+)\)/);
  const base = trimmed.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const parts: string[] = [];
  if (base) parts.push(base);
  if (parenMatch?.[1]?.trim()) parts.push(parenMatch[1].trim());

  return parts.join(" ").replace(/\s+/g, " ").trim() || trimmed;
}

export function normalizeNewsMatchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function tokenizeForRelevance(fragment: string): string[] {
  const cleaned = fragment
    .replace(/["']/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  const tokens: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    const t = normalizeNewsMatchText(raw);
    if (!t || t.length < 2) continue;
    if (NEWS_MATCH_STOPWORDS.has(t)) continue;
    tokens.push(t);
  }
  return tokens;
}

function tokensFromBranch(branch: string): string[] {
  if (/\s+AND\s+/i.test(branch)) {
    const parts = branch.split(/\s+AND\s+/i);
    return parts.flatMap((p) => tokenizeForRelevance(p));
  }
  return tokenizeForRelevance(branch);
}

/** Derive match rules from the query string sent to Serper News. */
export function buildSerperRelevanceSpec(query: string): SerperRelevanceSpec {
  const trimmed = query.trim();
  if (!trimmed) {
    return { allOf: [], anyOf: [] };
  }

  if (/\s+OR\s+/i.test(trimmed)) {
    const branches = trimmed
      .split(/\s+OR\s+/i)
      .map((b) => b.trim())
      .filter(Boolean);
    const anyOf = branches
      .map((b) => tokensFromBranch(b))
      .filter((group) => group.length > 0);
    if (anyOf.length > 0) {
      return { allOf: [], anyOf };
    }
  }

  const allOf = tokensFromBranch(trimmed);
  return { allOf, anyOf: [] };
}

const tokenRegexCache = new Map<string, RegExp>();

/**
 * Whole-token match (not substring) so short tokens like `su` (Lisa Su)
 * don't spuriously match inside words like "supports" or "Sunday".
 * Boundaries are defined as transitions to/from a Latin letter or digit,
 * which keeps hyphenated names (e.g. "jay-z") and possessives ("lisa's")
 * matching while rejecting embedded substrings.
 */
function tokenInText(combined: string, token: string): boolean {
  let re = tokenRegexCache.get(token);
  if (!re) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
    tokenRegexCache.set(token, re);
  }
  return re.test(combined);
}

export function articleMatchesRelevance(
  title: string | undefined,
  snippet: string | undefined,
  spec: SerperRelevanceSpec,
): boolean {
  const combined = normalizeNewsMatchText(`${title ?? ""} ${snippet ?? ""}`);
  if (!combined.trim()) return false;

  const required = spec.allOf.length > 0 ? spec.allOf : null;
  const alternatives = spec.anyOf.length > 0 ? spec.anyOf : null;

  if (!required && !alternatives) {
    return true;
  }

  if (alternatives) {
    return alternatives.some((group) =>
      group.every((token) => tokenInText(combined, token)),
    );
  }

  return required!.every((token) => tokenInText(combined, token));
}

/** Stable slug for Serper News cache keys from the resolved query. */
export function serperNewsCacheSlug(query: string): string {
  return query
    .replace(/\s+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_\u00c0-\u024f-]/g, "")
    .slice(0, 120);
}
