/**
 * OG SVG fonts for sharp/librsvg.
 *
 * librsvg on Linux ignores @font-face data-URI embeds (WOFF/WOFF2/TTF base64).
 * Text must use system-installed fonts via fontconfig — install `fonts-inter`
 * on Railway (see nixpacks.toml). Bundled files under server/assets/fonts/
 * are copied to dist/og-fonts/ at build as a TTF fallback for fc-cache.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Quoted families for SVG font-family. Inter first (fonts-inter on Linux),
 * then common Linux fallbacks.
 */
export const OG_FONT_FAMILY =
  "Inter, DejaVu Sans, Liberation Sans, sans-serif";

export const FONT_SEARCH_PATHS = [
  path.join(process.cwd(), "server", "assets", "fonts"),
  path.join(process.cwd(), "dist", "og-fonts"),
  path.resolve(__dirname, "../assets/fonts"),
];

let startupLogged = false;

/**
 * librsvg does not use embedded @font-face; return empty so SVG relies on
 * fontconfig + system fonts (Inter from fonts-inter apt package on Railway).
 */
export function getOgFontFaceStyle(): string {
  return "";
}

/** Log once at startup how OG SVG text will be rendered. */
export function logOgFontStartup(): void {
  if (startupLogged) return;
  startupLogged = true;

  const bundled = FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir));
  const interOnSystem = detectInterOnSystem();

  if (interOnSystem) {
    console.log(
      `[og] SVG text uses system fonts (Inter via fontconfig). Stack: ${OG_FONT_FAMILY}`,
    );
  } else {
    console.warn(
      `[og] Inter not detected in system font paths — OG SVG text may use DejaVu/Liberation fallback. Install fonts-inter on the image. Bundled font dirs found: ${bundled}`,
    );
  }
}

function detectInterOnSystem(): boolean {
  const roots = [
    "/usr/share/fonts",
    "/usr/local/share/fonts",
    "/nix/store",
  ];
  const needle = /inter/i;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      if (walkForInterFont(root, needle, 0)) return true;
    } catch {
      /* ignore permission errors on deep walks */
    }
  }
  return false;
}

function walkForInterFont(
  dir: string,
  needle: RegExp,
  depth: number,
): boolean {
  if (depth > 6) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (walkForInterFont(full, needle, depth + 1)) return true;
    } else if (ent.isFile() && /\.(ttf|otf|ttc)$/i.test(ent.name)) {
      if (needle.test(ent.name)) return true;
    }
  }
  return false;
}

/** True when bundled font directory exists (for build/nixpacks fallback). */
export function assertOgFontAssetsPresent(): boolean {
  return FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir));
}

/** @deprecated System-font mode — always empty @font-face for librsvg. */
export function assertOgFontsLoaded(): boolean {
  return getOgFontFaceStyle() === "";
}
