/**
 * Renders public/fonts/vox-mark-email.png from Noto Sans (U+A75E).
 * Same source font as vox-mark.woff2 — see client/src/index.css.
 *
 *   npx tsx scripts/generate-vox-mark-email-png.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import opentype from "opentype.js";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FONT_PATH = path.join(ROOT, "scripts", ".cache", "NotoSans-Regular.ttf");
const OUT_PATH = path.join(ROOT, "public", "fonts", "vox-mark-email.png");

const VOX_GLYPH = "\u{A75E}";
const FONT_SIZE = 14;
const FILL = "#F9FAFB";
const PAD = 1;

async function main(): Promise<void> {
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(
      `Missing ${FONT_PATH}. Download Noto Sans Regular for pyftsubset / woff2 workflow.`,
    );
  }

  const font = opentype.parse(fs.readFileSync(FONT_PATH));
  const glyphPath = font.getPath(VOX_GLYPH, 0, FONT_SIZE, FONT_SIZE);
  const bbox = glyphPath.getBoundingBox();
  const w = Math.ceil(bbox.x2 - bbox.x1) + PAD * 2;
  const h = Math.ceil(bbox.y2 - bbox.y1) + PAD * 2;
  const tx = PAD - bbox.x1;
  const ty = PAD - bbox.y1;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <g transform="translate(${tx},${ty})">
    <path d="${glyphPath.toPathData(2)}" fill="${FILL}"/>
  </g>
</svg>`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(OUT_PATH);
  console.log(`[generate-vox-mark-email-png] Wrote ${OUT_PATH} (${w}x${h})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
