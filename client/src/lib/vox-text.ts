/** Characters that must never paint as the Vox mark. U+A75E falls back to ₩ on some Android fonts. */
export const VOX_MARK_CODEPOINTS = ["\u{A75E}", "\u{A75F}", "\u{20A9}"] as const;

const MARK_PATTERN = new RegExp(`[${VOX_MARK_CODEPOINTS.join("")}]`, "u");
const MARK_SPLIT = new RegExp(`(${VOX_MARK_CODEPOINTS.join("|")})`, "u");

export type VoxTextPart =
  | { type: "text"; value: string }
  | { type: "mark" };

/** Split a formatted amount so the symbol can render as an SVG instead of a font glyph. */
export function splitVoxText(input: string): VoxTextPart[] {
  if (!input) return [];
  const raw = input.split(MARK_SPLIT);
  const parts: VoxTextPart[] = [];
  for (const piece of raw) {
    if (!piece) continue;
    if (MARK_PATTERN.test(piece) && piece.length === 1) {
      parts.push({ type: "mark" });
    } else if (MARK_PATTERN.test(piece)) {
      // A run that still contains a mark (shouldn't happen with the split) is walked char-wise.
      for (const ch of piece) {
        if (MARK_PATTERN.test(ch)) parts.push({ type: "mark" });
        else parts.push({ type: "text", value: ch });
      }
    } else {
      parts.push({ type: "text", value: piece });
    }
  }
  return parts;
}

export function textHasVoxMark(input: string): boolean {
  return MARK_PATTERN.test(input);
}
