/**
 * Pure helpers for extracting an attributed net-worth figure from
 * news snippets / web-search text. No DB or API deps so the logic is
 * fully unit-testable.
 *
 * Public consumers (profile-generator.ts) wrap these to source the
 * snippets from Serper or the OpenAI web-search tool.
 */

/** Sentence-level money pattern; same shape as the one used in profile-generator. */
export const MONEY_RE = /\$[\d,.]+(?:\s*(?:-|to)\s*\$?[\d,.]+)?\s*(?:billion|million|trillion|thousand|[KMBT])\b/i;

/** Context words that mark a money figure as a net-worth claim (vs revenue, donation, etc.). */
export const NET_WORTH_CONTEXT_RE = /\b(net worth|fortune|wealth|worth an estimated|estimated worth)\b/i;

/** Salary/earnings language — figures closer to these than to net-worth context are skipped. */
export const SALARY_CONTEXT_RE = /\b(salary|salaries|earning|earnings|paid|pays|paycheck|annual pay|per year|a year)\b/i;

/**
 * Above any real individual's wealth with comfortable headroom. The top of
 * the planet today is ~$0.8T (Musk) and growing; $5T is a defensive ceiling
 * for true junk like a snippet that pulled an Apple market cap or a fund's
 * AUM into a "net worth" context. NOT a cap on real billionaires.
 */
export const MAX_PLAUSIBLE_NET_WORTH_USD = 5_000_000_000_000;

/**
 * Relative spread above which two credible figures are treated as a
 * disagreement and collapsed into an approximate range instead of
 * picking the first hit.
 */
export const MATERIAL_DISAGREEMENT_RATIO = 1.5;

/**
 * Cap on range width. Spreads wider than this (e.g. $25M vs $1.1B) are
 * almost always salary/earnings mixed with net worth, or cross-person
 * leaks — drop outliers around the median instead of publishing junk.
 */
export const MAX_RANGE_RATIO = 4;

/**
 * Reputable financial / news outlets that commonly publish net-worth estimates.
 * Broad enough to surface a ballpark figure for almost everyone instead of
 * falling back to "Not available".
 */
export const TRUSTED_NET_WORTH_HOSTS = [
  "forbes.com",
  "bloomberg.com",
  "celebritynetworth.com",
  "reuters.com",
  "apnews.com",
  "cnbc.com",
  "wsj.com",
  "ft.com",
  "businessinsider.com",
  "fortune.com",
  "marketwatch.com",
  "investopedia.com",
  "money.com",
  "nytimes.com",
  "axios.com",
  "yahoo.com",
  "moneyweek.com",
  "wikipedia.org",
  "time.com",
  "cnn.com",
  "bbc.com",
  "theguardian.com",
];

export interface NetWorthSnippet {
  title: string;
  snippet: string;
  link: string;
}

export type NetWorthCandidateTier = "trusted" | "web";

export interface NetWorthCandidate {
  value: string;
  usd: number;
  tier: NetWorthCandidateTier;
  link: string;
}

function unitMultiplier(unit: string): number {
  const u = unit.toLowerCase();
  if (u === "trillion" || u === "t") return 1e12;
  if (u === "billion" || u === "b") return 1e9;
  if (u === "million" || u === "m") return 1e6;
  if (u === "thousand" || u === "k") return 1e3;
  return 1;
}

/** Parse "$X billion/million/..." (or a same-unit range) to a USD number. */
export function parseNetWorthToUsd(value: string): number | null {
  // Inline range with a shared trailing unit: "$5-$18 million", "$5 to $18M".
  // Without this, the first number is treated as raw dollars (usd≈5).
  const range = value.match(
    /\$?\s*([\d,.]+)\s*(?:-|to)\s*\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])\b/i,
  );
  if (range) {
    const mult = unitMultiplier(range[3]);
    const low = parseFloat(range[1].replace(/,/g, ""));
    const high = parseFloat(range[2].replace(/,/g, ""));
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    // Midpoint for clustering / dedupe; the display value keeps the full range.
    return ((low + high) / 2) * mult;
  }

  const m = value.match(/\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])?\b/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  return num * unitMultiplier(m[2] ?? "");
}

export function isImplausibleNetWorth(value: string): boolean {
  const usd = parseNetWorthToUsd(value);
  return usd != null && usd > MAX_PLAUSIBLE_NET_WORTH_USD;
}

export function isLikelyNetWorthSource(text: string): boolean {
  return NET_WORTH_CONTEXT_RE.test(text);
}

export function isTrustedNetWorthSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return TRUSTED_NET_WORTH_HOSTS.some((trusted) => host === trusted || host.endsWith(`.${trusted}`));
  } catch {
    return false;
  }
}

/** Expand $5M / $1.5B shorthand and tidy whitespace / inline ranges. */
export function normalizeMoney(value: string): string {
  let next = value
    .replace(/\s+/g, " ")
    .replace(/\$ /g, "$")
    .trim();

  // "$5-$18 million" / "$5 to $18M" → compact long-form range with shared unit.
  const range = next.match(
    /^\$?\s*([\d,.]+)\s*(?:-|to)\s*\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])\b$/i,
  );
  if (range) {
    const mult = unitMultiplier(range[3]);
    const low = parseFloat(range[1].replace(/,/g, "")) * mult;
    const high = parseFloat(range[2].replace(/,/g, "")) * mult;
    if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0) {
      return formatNetWorthRange(Math.min(low, high), Math.max(low, high));
    }
  }

  return next.replace(/\$([\d,.]+)\s*([KMBT])\b/gi, (_full, num: string, unit: string) => {
    const u = unit.toUpperCase();
    const word = u === "T" ? "trillion" : u === "B" ? "billion" : u === "M" ? "million" : "thousand";
    return `$${num} ${word}`;
  });
}

/**
 * Name variants for attribution: "Mr Beast" ↔ "MrBeast".
 * Parenthetical qualifiers become disambiguators ("Lisa (Blackpink)" →
 * "lisa blackpink") — never a bare single-token first name, which would
 * match unrelated people (Lisa Su, Lisa Kudrow, etc.).
 */
export function personNameVariants(personName: string): string[] {
  const trimmed = personName.trim();
  if (!trimmed) return [];
  const variants = new Set<string>();
  const add = (value: string) => {
    const v = value.trim().toLowerCase().replace(/\s+/g, " ");
    if (v) variants.add(v);
  };
  add(trimmed);
  add(trimmed.replace(/\s+/g, ""));
  add(trimmed.replace(/\s+/g, "-"));

  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const base = parenMatch[1].trim();
    const qualifier = parenMatch[2].trim();
    const baseTokens = base.split(/\s+/).filter(Boolean);
    // Multi-word bases are safe without the parenthetical.
    if (baseTokens.length >= 2) {
      add(base);
      add(base.replace(/\s+/g, ""));
    }
    // Keep the qualifier attached so "Lisa (Blackpink)" cannot match "Lisa Su".
    add(`${base} ${qualifier}`);
    add(`${base}${qualifier}`);
    add(`${base}-${qualifier}`);
  }

  return [...variants];
}

/** True if text mentions the person via any safe name variant. */
export function textMentionsPerson(text: string, personName: string): boolean {
  const lower = text.toLowerCase();
  return personNameVariants(personName).some((variant) => lower.includes(variant));
}

function sentenceContaining(text: string, index: number): string {
  const delimiters = [".", "!", "?"];
  let start = 0;
  for (const d of delimiters) {
    const idx = text.lastIndexOf(d, Math.max(0, index - 1));
    if (idx >= start) start = idx + 1;
  }
  let end = text.length;
  for (const d of delimiters) {
    const idx = text.indexOf(d, index);
    if (idx !== -1 && idx < end) end = idx + 1;
  }
  return text.slice(start, end);
}

function nearestContextDistance(text: string, moneyIndex: number, moneyLen: number, contextRe: RegExp): number {
  const moneyMid = moneyIndex + moneyLen / 2;
  let minDist = Infinity;
  for (const ctx of text.matchAll(new RegExp(contextRe.source, "gi"))) {
    const ctxMid = (ctx.index ?? 0) + ctx[0].length / 2;
    minDist = Math.min(minDist, Math.abs(moneyMid - ctxMid));
  }
  return minDist;
}

/**
 * Score a money figure against net-worth context. Prefer phrases where
 * "net worth" appears shortly BEFORE the figure ("net worth of $5m") over
 * labels that follow a different amount ("Potential: $14m Net Worth: $5m").
 */
function netWorthContextScore(text: string, moneyStart: number, moneyLen: number): number {
  const moneyMid = moneyStart + moneyLen / 2;
  let best = Infinity;
  for (const ctx of text.matchAll(new RegExp(NET_WORTH_CONTEXT_RE.source, "gi"))) {
    const ctxStart = ctx.index ?? 0;
    const ctxEnd = ctxStart + ctx[0].length;
    const absDist = Math.abs(moneyMid - (ctxStart + ctx[0].length / 2));
    if (absDist > 100) continue;
    // Strong bonus when context precedes the figure within 40 chars.
    const score = ctxEnd <= moneyStart && moneyStart - ctxEnd <= 40
      ? absDist * 0.25
      : absDist + (ctxStart >= moneyStart + moneyLen ? 40 : 0);
    best = Math.min(best, score);
  }
  return best;
}

/**
 * Prefer the money figure closest to net-worth language. Skip figures that
 * sit nearer salary/earnings language than net-worth language (e.g. "$65M
 * annually … net worth around $250M").
 */
export function extractNetWorthMoney(text: string): RegExpMatchArray | null {
  const moneyMatches = [...text.matchAll(new RegExp(MONEY_RE.source, "gi"))];
  let best: { match: RegExpMatchArray; score: number } | null = null;

  for (const match of moneyMatches) {
    const moneyStart = match.index ?? 0;
    const score = netWorthContextScore(text, moneyStart, match[0].length);
    if (!Number.isFinite(score) || score === Infinity) continue;

    const netWorthDist = nearestContextDistance(text, moneyStart, match[0].length, NET_WORTH_CONTEXT_RE);
    const salaryDist = nearestContextDistance(text, moneyStart, match[0].length, SALARY_CONTEXT_RE);
    if (Number.isFinite(salaryDist) && salaryDist < netWorthDist) continue;

    if (!best || score < best.score) {
      best = { match, score };
    }
  }

  return best?.match ?? null;
}

/**
 * Returns true if the money figure at `match.index` is attributed to
 * `personName` in `text`.
 *
 * Accepts when a name variant appears in the same sentence as the figure,
 * or within a tight proximity window. Same-sentence catches list/ranking
 * leaks (Magyar named earlier, "$245m, is Orb…" later). Tight proximity
 * still covers bullet-style OpenAI research notes where the name is in a
 * nearby header line.
 */
export function isMoneyAttributedToPerson(
  text: string,
  match: RegExpMatchArray,
  personName: string,
  windowChars = 80,
): boolean {
  if (!personName.trim()) return false;
  if (textMentionsPerson(sentenceContaining(text, match.index ?? 0), personName)) {
    return true;
  }

  const moneyStart = match.index ?? 0;
  const moneyEnd = moneyStart + match[0].length;
  const lower = text.toLowerCase();

  for (const needle of personNameVariants(personName)) {
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(needle, searchFrom);
      if (idx === -1) break;
      const distance = idx >= moneyEnd ? idx - moneyEnd : moneyStart - (idx + needle.length);
      if (distance <= windowChars) return true;
      searchFrom = idx + needle.length;
    }
  }
  return false;
}

type MoneyUnit = "trillion" | "billion" | "million" | "thousand" | "usd";

function unitForUsd(usd: number): MoneyUnit {
  if (usd >= 1e12) return "trillion";
  if (usd >= 1e9) return "billion";
  if (usd >= 1e6) return "million";
  if (usd >= 1e3) return "thousand";
  return "usd";
}

function formatUsdAmount(usd: number, unit: MoneyUnit): string {
  if (unit === "trillion") return `${Number((usd / 1e12).toFixed(usd / 1e12 >= 10 ? 0 : 1))}`;
  if (unit === "billion") return `${Number((usd / 1e9).toFixed(usd / 1e9 >= 10 ? 0 : 1))}`;
  if (unit === "million") return `${Number((usd / 1e6).toFixed(usd / 1e6 >= 10 ? 0 : 1))}`;
  if (unit === "thousand") return `${Number((usd / 1e3).toFixed(0))}`;
  return `${Math.round(usd)}`;
}

function formatUsdAsNetWorth(usd: number): string {
  const unit = unitForUsd(usd);
  if (unit === "usd") return `$${formatUsdAmount(usd, unit)}`;
  return `$${formatUsdAmount(usd, unit)} ${unit}`;
}

/** Compact same-unit ranges: "$5-$18 million" instead of "$5 million-$18 million". */
export function formatNetWorthRange(minUsd: number, maxUsd: number): string {
  const maxUnit = unitForUsd(maxUsd);
  const minUnit = unitForUsd(minUsd);
  if (maxUnit === minUnit && maxUnit !== "usd") {
    return `$${formatUsdAmount(minUsd, maxUnit)}-$${formatUsdAmount(maxUsd, maxUnit)} ${maxUnit}`;
  }
  return `${formatUsdAsNetWorth(minUsd)}-${formatUsdAsNetWorth(maxUsd)}`;
}

/**
 * Drop outliers that sit more than MAX_RANGE_RATIO away from the median.
 * Prevents absurd ranges like "$25 million-$1.1 billion".
 */
export function clusterNetWorthCandidates(
  candidates: ReadonlyArray<NetWorthCandidate>,
): NetWorthCandidate[] {
  if (candidates.length <= 1) return [...candidates];
  const sorted = [...candidates].sort((a, b) => a.usd - b.usd);
  const median = sorted[Math.floor(sorted.length / 2)].usd;
  const clustered = sorted.filter((c) => {
    const lo = Math.min(c.usd, median);
    const hi = Math.max(c.usd, median);
    return lo > 0 && hi / lo <= MAX_RANGE_RATIO;
  });
  return clustered.length > 0 ? clustered : [sorted[Math.floor(sorted.length / 2)]];
}

/**
 * Collect person-attributed net-worth candidates from snippets.
 * Trusted hosts are preferred; other web hosts are accepted only when the
 * snippet explicitly names the person, uses net-worth language, and passes
 * the attribution + plausibility gates.
 */
export function collectNetWorthCandidates(
  sources: ReadonlyArray<NetWorthSnippet>,
  personName: string,
): NetWorthCandidate[] {
  const candidates: NetWorthCandidate[] = [];

  for (const source of sources) {
    const sourceText = `${source.title} ${source.snippet}`;
    if (!isLikelyNetWorthSource(sourceText)) continue;

    const trusted = isTrustedNetWorthSource(source.link);
    // Broader web results still require the person to be named in the
    // snippet itself (title+snippet), not just the query.
    if (!trusted && !textMentionsPerson(sourceText, personName)) {
      continue;
    }

    const match = extractNetWorthMoney(sourceText);
    if (!match) continue;
    if (!isMoneyAttributedToPerson(sourceText, match, personName)) continue;

    const normalized = normalizeMoney(match[0]);
    if (isImplausibleNetWorth(normalized)) continue;
    const usd = parseNetWorthToUsd(normalized);
    if (usd == null || usd <= 0) continue;

    // Dedupe near-identical values (within 1% relative). Prefer keeping a
    // trusted candidate over a web one when they collide.
    const nearDuplicateIdx = candidates.findIndex(
      (c) => Math.abs(c.usd - usd) / Math.max(c.usd, usd) < 0.01,
    );
    if (nearDuplicateIdx >= 0) {
      if (trusted && candidates[nearDuplicateIdx].tier !== "trusted") {
        candidates[nearDuplicateIdx] = {
          value: normalized,
          usd,
          tier: "trusted",
          link: source.link,
        };
      }
      continue;
    }

    candidates.push({
      value: normalized,
      usd,
      tier: trusted ? "trusted" : "web",
      link: source.link,
    });
  }

  return candidates;
}

/**
 * Prefer trusted candidates. Drop extreme outliers, then when the remaining
 * figures disagree by MATERIAL_DISAGREEMENT_RATIO or more (but within
 * MAX_RANGE_RATIO), return a compact approximate range.
 */
export function resolveNetWorthFromCandidates(candidates: ReadonlyArray<NetWorthCandidate>): string | null {
  if (candidates.length === 0) return null;

  const trusted = candidates.filter((c) => c.tier === "trusted");
  const tiered = trusted.length > 0 ? trusted : [...candidates];
  const selected = clusterNetWorthCandidates(tiered).sort((a, b) => a.usd - b.usd);

  const min = selected[0];
  const max = selected[selected.length - 1];
  if (min.usd > 0 && max.usd / min.usd >= MATERIAL_DISAGREEMENT_RATIO) {
    return formatNetWorthRange(min.usd, max.usd);
  }

  // Prefer the earliest source-order candidate that survived clustering.
  // (Do not use USD-sorted order — that bias toward the low end of a band.)
  const preferred = tiered.find((c) => selected.includes(c))
    ?? selected[Math.floor(selected.length / 2)];
  return preferred.value;
}

/**
 * Extract a person-attributed net-worth figure from an array of snippets.
 * Trusted hosts are preferred; broader web hosts are accepted when they
 * pass attribution + net-worth-context + plausibility gates. Materially
 * disagreeing credible figures become an approximate range.
 */
export function extractNetWorthFromSnippets(
  sources: ReadonlyArray<NetWorthSnippet>,
  personName: string,
): string | null {
  return resolveNetWorthFromCandidates(collectNetWorthCandidates(sources, personName));
}

/**
 * Extract a person-attributed net-worth figure from a free-form text block
 * (e.g. the OpenAI web-search tool's output). The text is treated as one
 * combined source — no host check applies because the tool already cites
 * reputable URLs in the body.
 */
export function extractNetWorthFromText(text: string | null | undefined, personName: string): string | null {
  if (!text || !isLikelyNetWorthSource(text)) return null;
  const match = extractNetWorthMoney(text);
  if (!match) return null;
  if (!isMoneyAttributedToPerson(text, match, personName)) return null;
  const normalized = normalizeMoney(match[0]);
  return isImplausibleNetWorth(normalized) ? null : normalized;
}
