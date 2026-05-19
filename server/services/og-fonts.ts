/**
 * Shared Inter @font-face blocks for sharp/librsvg OG SVG rendering.
 *
 * Bundled copies live in server/assets/fonts/ (copied from @fontsource/inter).
 * Prefer .woff over .woff2 — librsvg on minimal Linux containers is more reliable
 * with woff/truetype data-URIs.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** SVG font-family stack with Linux-friendly fallbacks after Inter. */
export const OG_FONT_FAMILY =
  "'Inter', 'DejaVu Sans', 'Liberation Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

const BUNDLED_FONTS_DIR = path.resolve(__dirname, "../assets/fonts");

const FONT_FILES = {
  regular: "inter-latin-400-normal.woff",
  bold: "inter-latin-700-normal.woff",
} as const;

let cachedStyle: string | null = null;
let loadAttempted = false;

function readFontFile(
  fileName: string,
): { buf: Buffer; format: "woff" | "woff2" } | null {
  const tryPath = (p: string): { buf: Buffer; format: "woff" | "woff2" } | null => {
    if (!fs.existsSync(p)) return null;
    const format = p.endsWith(".woff2") ? "woff2" : "woff";
    return { buf: fs.readFileSync(p), format };
  };

  const bundled = path.join(BUNDLED_FONTS_DIR, fileName);
  const fromBundled = tryPath(bundled);
  if (fromBundled) return fromBundled;

  for (const filesDir of resolveFontsourceFilesDirs()) {
    const fromWoff = tryPath(path.join(filesDir, fileName));
    if (fromWoff) return fromWoff;
    const fromWoff2 = tryPath(
      path.join(filesDir, fileName.replace(/\.woff$/, ".woff2")),
    );
    if (fromWoff2) return fromWoff2;
  }

  return null;
}

function resolveFontsourceFilesDirs(): string[] {
  const dirs: string[] = [];
  try {
    const requireFromHere = createRequire(import.meta.url);
    const pkgJsonPath = requireFromHere.resolve(
      "@fontsource/inter/package.json",
    );
    dirs.push(path.join(path.dirname(pkgJsonPath), "files"));
  } catch {
    /* ignore */
  }

  dirs.push(
    path.join(process.cwd(), "node_modules/@fontsource/inter/files"),
    path.join(process.cwd(), "dist/node_modules/@fontsource/inter/files"),
  );

  return dirs;
}

function buildFontFaceStyle(
  regular: { buf: Buffer; format: "woff" | "woff2" },
  bold: { buf: Buffer; format: "woff" | "woff2" },
): string {
  const regularFormat = regular.format;
  const boldFormat = bold.format;
  const b64_400 = regular.buf.toString("base64");
  const b64_700 = bold.buf.toString("base64");

  return `<style>
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 400;
      src: url(data:font/${regularFormat};base64,${b64_400}) format('${regularFormat}');
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 500;
      src: url(data:font/${regularFormat};base64,${b64_400}) format('${regularFormat}');
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 600;
      src: url(data:font/${boldFormat};base64,${b64_700}) format('${boldFormat}');
    }
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 700;
      src: url(data:font/${boldFormat};base64,${b64_700}) format('${boldFormat}');
    }
  </style>`;
}

/**
 * Inline @font-face rules for OG SVGs. Cached after first successful load.
 */
export function getOgFontFaceStyle(): string {
  if (cachedStyle !== null) return cachedStyle;
  if (loadAttempted) return "";

  loadAttempted = true;
  try {
    const regular = readFontFile(FONT_FILES.regular);
    const bold = readFontFile(FONT_FILES.bold);
    if (!regular || !bold) {
      console.error(
        "[og] CRITICAL: Inter font files missing — OG SVG text may render as boxes. Checked:",
        BUNDLED_FONTS_DIR,
        resolveFontsourceFilesDirs().join(", "),
      );
      cachedStyle = "";
      return cachedStyle;
    }
    cachedStyle = buildFontFaceStyle(regular, bold);
    return cachedStyle;
  } catch (err) {
    console.error("[og] CRITICAL: failed to load Inter fonts for OG SVG", err);
    cachedStyle = "";
    return cachedStyle;
  }
}

/** For tests — true when @font-face block was built successfully. */
export function assertOgFontsLoaded(): boolean {
  const style = getOgFontFaceStyle();
  return style.includes("@font-face") && style.includes("base64");
}
