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

/**
 * Above any real individual's wealth with comfortable headroom. The top of
 * the planet today is ~$0.8T (Musk) and growing; $5T is a defensive ceiling
 * for true junk like a snippet that pulled an Apple market cap or a fund's
 * AUM into a "net worth" context. NOT a cap on real billionaires.
 */
export const MAX_PLAUSIBLE_NET_WORTH_USD = 5_000_000_000_000;

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

/** Parse "$X billion/million/..." to a USD number for sanity bounds. */
export function parseNetWorthToUsd(value: string): number | null {
  const m = value.match(/\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])?\b/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult =
    unit === "trillion" || unit === "t" ? 1e12
      : unit === "billion" || unit === "b" ? 1e9
        : unit === "million" || unit === "m" ? 1e6
          : unit === "thousand" || unit === "k" ? 1e3
            : 1;
  return num * mult;
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

export function normalizeMoney(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\$ /g, "$").trim();
}

/** Find a money match whose surrounding ±100 chars include net-worth context. */
export function extractNetWorthMoney(text: string): RegExpMatchArray | null {
  const moneyMatches = [...text.matchAll(new RegExp(MONEY_RE.source, "gi"))];
  return moneyMatches.find((match) => {
    const start = Math.max(0, (match.index ?? 0) - 100);
    const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 100);
    return NET_WORTH_CONTEXT_RE.test(text.slice(start, end));
  }) ?? null;
}

/**
 * Returns true if the money figure at `match.index` is attributed to
 * `personName` in `text` — i.e. the person's exact full name appears
 * within `windowChars` of the figure.
 *
 * This is intentionally a coarse proximity check, not a full linguistic
 * attribution analysis. It fixes the actually-reported bug class: a
 * snippet about person A (e.g. Musk's $828B) surfacing for a query about
 * person B (e.g. Farage) where B isn't mentioned in the snippet at all.
 *
 * Harder linguistic ambiguities ("Musk leads with $X, ahead of Bezos" —
 * does the figure belong to Musk or Bezos?) are deliberately left to
 * the downstream LLM step, which has the full context and an explicit
 * attribution instruction in its system prompt. A heuristic closest-
 * name-wins rule sounds good on paper but is unreliable in practice
 * because sentence boundaries, possessives, and trailing clauses all
 * break it in opposite directions.
 *
 * Why exact full name (not last-name token): last-name tokens introduce
 * ambiguity on common short names. The strict extractor errs toward
 * "Not available" and lets the LLM step handle looser forms.
 */
export function isMoneyAttributedToPerson(
  text: string,
  match: RegExpMatchArray,
  personName: string,
  windowChars = 150,
): boolean {
  const trimmedName = personName.trim();
  if (!trimmedName) return false;
  const moneyStart = match.index ?? 0;
  const moneyEnd = moneyStart + match[0].length;
  const lower = text.toLowerCase();
  const needle = trimmedName.toLowerCase();

  let searchFrom = 0;
  while (true) {
    const idx = lower.indexOf(needle, searchFrom);
    if (idx === -1) return false;
    const distance = idx >= moneyEnd ? idx - moneyEnd : moneyStart - (idx + needle.length);
    if (distance <= windowChars) return true;
    searchFrom = idx + needle.length;
  }
}

/**
 * Extract a person-attributed net-worth figure from an array of reputable
 * snippets. Returns the first snippet that:
 *  - sits on a trusted host
 *  - includes net-worth context language
 *  - has a money figure attributed to `personName` (proximity gate)
 *  - is below the implausibility ceiling
 */
export function extractNetWorthFromSnippets(
  sources: ReadonlyArray<NetWorthSnippet>,
  personName: string,
): string | null {
  for (const source of sources) {
    const sourceText = `${source.title} ${source.snippet}`;
    if (!isTrustedNetWorthSource(source.link) || !isLikelyNetWorthSource(sourceText)) continue;
    const match = extractNetWorthMoney(sourceText);
    if (!match) continue;
    if (!isMoneyAttributedToPerson(sourceText, match, personName)) continue;
    const normalized = normalizeMoney(match[0]);
    if (isImplausibleNetWorth(normalized)) continue;
    return normalized;
  }
  return null;
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
