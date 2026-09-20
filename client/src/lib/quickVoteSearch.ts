/**
 * In-memory Quick Vote search: AND-token match across vote-card names/titles
 * so a visitor can type "ronaldo messi" and land on that matchup.
 */

export type QuickVoteSearchCardType = "matchup" | "sentiment" | "opinion" | "rating";

export interface QuickVoteSearchRecord {
  id: string;
  index: number;
  type: QuickVoteSearchCardType;
  /** Primary result line (e.g. "Ronaldo vs Messi"). */
  label: string;
  titleHaystack: string;
  optionHaystack: string;
  extraHaystack?: string;
  thumbA?: string | null;
  thumbB?: string | null;
  /** Card is currently filtered out of the deck (hide-voted on). Search
   * bypasses the filter, so the hit still shows — tagged "voted". */
  hidden?: boolean;
}

export interface QuickVoteSearchHit {
  id: string;
  index: number;
  type: QuickVoteSearchCardType;
  label: string;
  thumbA?: string | null;
  thumbB?: string | null;
  hidden?: boolean;
  score: number;
}

export const QUICK_VOTE_SEARCH_MIN_CHARS = 2;
export const QUICK_VOTE_SEARCH_RESULT_CAP = 12;

export function normalizeQuickVoteQuery(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tokenizeQuickVoteQuery(raw: string): string[] {
  return normalizeQuickVoteQuery(raw).split(" ").filter(Boolean);
}

function scoreRecord(tokens: string[], record: QuickVoteSearchRecord): number {
  const title = normalizeQuickVoteQuery(record.titleHaystack);
  const options = normalizeQuickVoteQuery(record.optionHaystack);
  const extra = normalizeQuickVoteQuery(record.extraHaystack ?? "");
  const all = `${title} ${options} ${extra}`.trim();
  if (!tokens.every((t) => all.includes(t))) return 0;

  let score = 10;
  if (options && tokens.every((t) => options.includes(t))) score += 100;
  else if (title && tokens.every((t) => title.includes(t))) score += 40;

  const optionPad = ` ${options} `;
  const titlePad = ` ${title} `;
  for (const t of tokens) {
    if (optionPad.includes(` ${t}`)) score += 8;
    else if (titlePad.includes(` ${t}`)) score += 3;
  }
  return score;
}

export function searchQuickVoteCards(
  query: string,
  records: QuickVoteSearchRecord[],
): QuickVoteSearchHit[] {
  const normalized = normalizeQuickVoteQuery(query);
  if (normalized.length < QUICK_VOTE_SEARCH_MIN_CHARS) return [];
  const tokens = tokenizeQuickVoteQuery(query);
  if (tokens.length === 0) return [];

  const hits: QuickVoteSearchHit[] = [];
  for (const record of records) {
    const score = scoreRecord(tokens, record);
    if (score <= 0) continue;
    hits.push({
      id: record.id,
      index: record.index,
      type: record.type,
      label: record.label,
      thumbA: record.thumbA,
      thumbB: record.thumbB,
      hidden: record.hidden,
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  return hits.slice(0, QUICK_VOTE_SEARCH_RESULT_CAP);
}

export function matchupSearchLabel(
  optionA?: string | null,
  optionB?: string | null,
  fallback?: string | null,
): string {
  const a = optionA?.trim() ?? "";
  const b = optionB?.trim() ?? "";
  if (a && b) return `${a} vs ${b}`;
  return (fallback ?? "").trim() || a || b || "Matchup";
}
