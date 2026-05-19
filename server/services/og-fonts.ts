/**
 * Bundled Inter TTF paths for matchup OG path-outlined text (opentype.js).
 * librsvg via sharp cannot render SVG <text> reliably on Linux — see og-svg-text-paths.ts.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Used by legacy dynamic OG SVG in og-routes (not matchup overlays). */
export const OG_FONT_FAMILY =
  "Inter, DejaVu Sans, Liberation Sans, sans-serif";

export const FONT_SEARCH_PATHS = [
  path.join(process.cwd(), "server", "assets", "fonts"),
  path.join(process.cwd(), "dist", "og-fonts"),
  path.resolve(__dirname, "../assets/fonts"),
];

let startupLogged = false;

/** Legacy — matchup overlays use path outlines, not @font-face. */
export function getOgFontFaceStyle(): string {
  return "";
}

/** Log once at startup. */
export function logOgFontStartup(): void {
  if (startupLogged) return;
  startupLogged = true;

  const bundled = FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir));
  if (bundled) {
    console.log(
      "[og] Matchup OG overlay text uses path outlines from bundled Inter TTF (opentype.js).",
    );
  } else {
    console.warn(
      "[og] Bundled Inter TTF not found — matchup OG text may fail. Checked:",
      FONT_SEARCH_PATHS.join(", "),
    );
  }
}

/** True when bundled font directory exists. */
export function assertOgFontAssetsPresent(): boolean {
  return FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir));
}
