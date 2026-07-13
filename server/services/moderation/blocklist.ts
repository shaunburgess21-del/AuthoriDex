/**
 * Tiny local prefilter for obvious abuse tokens.
 * Catches clear cases without an API round-trip; never the only line of defense.
 */

/** Whole-word-ish patterns. Keep short — false positives hurt UX. */
const BLOCKLIST_PATTERNS: RegExp[] = [
  /\b(child\s*porn|cp\s*video|csam)\b/i,
  /\b(nigger|niggers)\b/i,
  /\b(kill\s+yourself|kys)\b/i,
];

export function matchLocalBlocklist(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of BLOCKLIST_PATTERNS) {
    if (pattern.test(text)) {
      hits.push(pattern.source);
    }
  }
  return hits;
}
