/**
 * Convert labels to SVG path outlines for sharp/librsvg (no fontconfig).
 */
import fs from "fs";
import path from "path";
import opentype from "opentype.js";
import { FONT_SEARCH_PATHS } from "./og-fonts";

const FONT_FILES = {
  regular: "inter-latin-400-normal.ttf",
  bold: "inter-latin-700-normal.ttf",
} as const;

let regularFont: opentype.Font | null = null;
let boldFont: opentype.Font | null = null;

function resolveFontsDir(): string | null {
  for (const dir of FONT_SEARCH_PATHS) {
    const regular = path.join(dir, FONT_FILES.regular);
    const bold = path.join(dir, FONT_FILES.bold);
    if (fs.existsSync(regular) && fs.existsSync(bold)) return dir;
  }
  return null;
}

function loadFonts(): { regular: opentype.Font; bold: opentype.Font } {
  if (regularFont && boldFont) {
    return { regular: regularFont, bold: boldFont };
  }
  const dir = resolveFontsDir();
  if (!dir) {
    throw new Error(
      `[og] Inter TTF not found for path outlines. Checked: ${FONT_SEARCH_PATHS.join(", ")}`,
    );
  }
  regularFont = opentype.parse(
    fs.readFileSync(path.join(dir, FONT_FILES.regular)),
  );
  boldFont = opentype.parse(
    fs.readFileSync(path.join(dir, FONT_FILES.bold)),
  );
  if (!regularFont?.getPath || !boldFont?.getPath) {
    throw new Error("[og] Failed to parse Inter TTF for path outlines");
  }
  return { regular: regularFont, bold: boldFont };
}

export type TextPathOptions = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight?: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  letterSpacing?: number;
  opacity?: number;
};

function pickFont(weight: number): opentype.Font {
  const { regular, bold } = loadFonts();
  return weight >= 600 ? bold : regular;
}

function measureTextWidth(
  font: opentype.Font,
  text: string,
  fontSize: number,
  letterSpacing: number,
): number {
  if (!text) return 0;
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += font.getAdvanceWidth(text[i]!, fontSize);
    if (i < text.length - 1) w += letterSpacing;
  }
  return w;
}

/**
 * Serialize glyph path commands to SVG path data ourselves — do NOT use
 * opentype's Path.toPathData().
 *
 * opentype.js 2.0's toPathData() rounds each coordinate via an
 * exponent-string trick (`+(Math.round(v + "e+2") + "e-2")`). When a
 * coordinate's fractional part is small enough that JavaScript stringifies
 * it in scientific notation (e.g. x = 360.00000000000006 → fraction
 * 5.7e-14 → `Math.round("5.7e-14e+2")`), the result is NaN. A single NaN
 * token makes librsvg abort the rest of that <path> element, silently
 * truncating the label mid-glyph. Accumulated per-glyph x offsets land on
 * such floats routinely, so this hit real market titles in production.
 * toFixed() never emits scientific notation for coordinates in our range,
 * and the command values themselves are always finite.
 */
function commandsToPathData(commands: opentype.PathCommand[]): string {
  const num = (v: number): string => {
    const fixed = v.toFixed(2);
    // "-0.00" parses fine but is noise — normalise to "0.00".
    return fixed === "-0.00" ? "0.00" : fixed;
  };
  let d = "";
  for (const c of commands) {
    if (c.type === "M" || c.type === "L") {
      d += `${c.type}${num(c.x)} ${num(c.y)}`;
    } else if (c.type === "C") {
      d += `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
    } else if (c.type === "Q") {
      d += `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
    } else if (c.type === "Z") {
      d += "Z";
    }
  }
  return d;
}

function pathDataForText(
  font: opentype.Font,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  letterSpacing: number,
): string {
  if (!text) return "";
  const parts: string[] = [];
  let xPos = x;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const glyphPath = font.getPath(char, xPos, y, fontSize);
    if (glyphPath) {
      const d = commandsToPathData(glyphPath.commands);
      if (d) parts.push(d);
    }
    xPos += font.getAdvanceWidth(char, fontSize);
    if (i < text.length - 1) xPos += letterSpacing;
  }
  return parts.join(" ");
}

/**
 * SVG path element(s) for one label — no font-family, safe for librsvg.
 */
export function textPath(opts: TextPathOptions): string {
  const {
    text,
    x,
    y,
    fontSize,
    weight = 400,
    fill,
    anchor = "start",
    letterSpacing = 0,
    opacity,
  } = opts;

  if (!text) return "";

  const font = pickFont(weight);
  const w = measureTextWidth(font, text, fontSize, letterSpacing);
  let xStart = x;
  if (anchor === "middle") {
    xStart = x - w / 2;
  } else if (anchor === "end") {
    xStart = x - w;
  }

  const d = pathDataForText(font, text, xStart, y, fontSize, letterSpacing);
  if (!d) return "";

  const opacityAttr =
    opacity !== undefined ? ` opacity="${opacity}"` : "";
  return `<path fill="${fill}"${opacityAttr} d="${d}"/>`;
}

function fontVerticalMetrics(font: opentype.Font) {
  const unitsPerEm = font.tables.head?.unitsPerEm ?? 1000;
  const ascender =
    font.tables.hhea?.ascender ?? font.tables.os2?.sTypoAscender ?? 0;
  const descender =
    font.tables.hhea?.descender ?? font.tables.os2?.sTypoDescender ?? 0;
  return { unitsPerEm, ascender, descender };
}

function scaledMetric(
  font: opentype.Font,
  units: number,
  fontSize: number,
): number {
  const { unitsPerEm } = fontVerticalMetrics(font);
  return (units / unitsPerEm) * fontSize;
}

/** Pixels from baseline to bottom of glyph ink (descender). */
export function glyphExtentBelowBaseline(
  fontSize: number,
  weight = 400,
): number {
  const font = pickFont(weight);
  const { descender } = fontVerticalMetrics(font);
  return scaledMetric(font, Math.abs(descender), fontSize);
}

/** Baseline Y for a line stacked above another (fixed visual gap in px). */
export function baselineForStackAbove(opts: {
  targetBaseline: number;
  targetFontSize: number;
  targetWeight: number;
  upperFontSize: number;
  upperWeight: number;
  gap: number;
}): number {
  const {
    targetBaseline,
    targetFontSize,
    targetWeight,
    upperFontSize,
    upperWeight,
    gap,
  } = opts;
  const targetFont = pickFont(targetWeight);
  const upperFont = pickFont(upperWeight);
  const targetMetrics = fontVerticalMetrics(targetFont);
  const upperMetrics = fontVerticalMetrics(upperFont);
  const targetTop =
    targetBaseline -
    scaledMetric(targetFont, targetMetrics.ascender, targetFontSize);
  const upperDescent = scaledMetric(
    upperFont,
    Math.abs(upperMetrics.descender),
    upperFontSize,
  );
  return targetTop - gap - upperDescent;
}

/** Pixel width for path-outlined text (pill sizing, layout). */
export function measureOutlinedTextWidth(
  text: string,
  fontSize: number,
  weight = 400,
  letterSpacing = 0,
): number {
  if (!text) return 0;
  const font = pickFont(weight);
  return measureTextWidth(font, text, fontSize, letterSpacing);
}

/** For startup logging / tests. */
export function assertOgPathFontsLoaded(): boolean {
  try {
    loadFonts();
    return true;
  } catch {
    return false;
  }
}
