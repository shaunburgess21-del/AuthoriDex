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
  anchor?: "start" | "middle";
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
    if (glyphPath) parts.push(glyphPath.toPathData(2));
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
  let xStart = x;
  if (anchor === "middle") {
    const w = measureTextWidth(font, text, fontSize, letterSpacing);
    xStart = x - w / 2;
  }

  const d = pathDataForText(font, text, xStart, y, fontSize, letterSpacing);
  if (!d) return "";

  const opacityAttr =
    opacity !== undefined ? ` opacity="${opacity}"` : "";
  return `<path fill="${fill}"${opacityAttr} d="${d}"/>`;
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
