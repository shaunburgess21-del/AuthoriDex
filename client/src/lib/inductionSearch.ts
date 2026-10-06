/**
 * Name search for the Induction Queue: accent- and case-insensitive, every
 * query word must appear somewhere in the name, and results that start with
 * the query rank above mid-word matches.
 */

export interface HighlightRange {
  start: number;
  end: number;
}

interface NormalizedName {
  text: string;
  /** normalized index -> original string index */
  map: number[];
}

function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function foldText(value: string): string {
  return foldChar(value).trim().replace(/\s+/g, " ");
}

function normalizeName(name: string): NormalizedName {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < name.length; i++) {
    const folded = foldChar(name[i]);
    for (let j = 0; j < folded.length; j++) {
      text += folded[j];
      map.push(i);
    }
  }
  return { text, map };
}

export function queryTokens(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/** Lower is better; null = no match. */
export function scoreNameMatch(name: string, tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  const { text } = normalizeName(name);
  for (const token of tokens) {
    if (!text.includes(token)) return null;
  }
  const phrase = tokens.join(" ");
  if (text.startsWith(phrase)) return 0;
  const words = text.split(/[\s\-.']+/);
  if (words.some((w) => w.startsWith(tokens[0]))) return 1;
  return 2;
}

export function highlightRanges(name: string, tokens: string[]): HighlightRange[] {
  const { text, map } = normalizeName(name);
  const ranges: HighlightRange[] = [];
  for (const token of tokens) {
    const at = text.indexOf(token);
    if (at < 0) continue;
    ranges.push({ start: map[at], end: map[at + token.length - 1] + 1 });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Filter + rank by match quality, then by the caller's existing order. */
export function searchByName<T>(items: T[], query: string, getName: (item: T) => string): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  return items
    .map((item, index) => ({ item, index, score: scoreNameMatch(getName(item), tokens) }))
    .filter((row): row is { item: T; index: number; score: number } => row.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((row) => row.item);
}
