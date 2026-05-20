/**
 * Pick the first usable absolute image URL from a list of candidates.
 * Used by carousel thumbs to mirror VersusCard / list API fallback chains.
 */
export function coalesceHttpImage(
  ...candidates: (string | null | undefined)[]
): string | null {
  for (const c of candidates) {
    const trimmed = c?.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}
