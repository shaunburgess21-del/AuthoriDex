/**
 * One-off: replace near-white backgrounds on favorite-color poll option images
 * with a softer light grey. Run:
 *   npx tsx --env-file=.env server/scripts/recolor-poll-option-backgrounds.ts
 */
import sharp from "sharp";
import { supabaseServer } from "../supabase";

const BUCKET = "opinion-polls";
const FOLDER = "favorite-color";
const FILES = ["black.webp", "grey.webp", "navy.webp"] as const;

/** Visible light grey on dark UI cards — slightly darker than prior pass. */
const TARGET = { r: 118, g: 126, b: 138 };

/** Background + prior recolor passes. */
const BRIGHTNESS_MIN = 140;
const SATURATION_MAX = 0.2;

async function recolorBackground(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;

    if (max >= BRIGHTNESS_MIN && saturation <= SATURATION_MAX) {
      pixels[i] = TARGET.r;
      pixels[i + 1] = TARGET.g;
      pixels[i + 2] = TARGET.b;
      pixels[i + 3] = 255;
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .webp({ quality: 88 })
    .toBuffer();
}

async function main() {
  const dryRun = process.env.DRY_RUN !== "false";
  console.log(`\n=== Recolor poll option backgrounds (DRY_RUN=${dryRun}) ===\n`);

  for (const file of FILES) {
    const objectPath = `${FOLDER}/${file}`;
    const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`;

    const res = await fetch(publicUrl);
    if (!res.ok) {
      console.error(`  FAIL: could not download ${objectPath} (${res.status})`);
      continue;
    }

    const input = Buffer.from(await res.arrayBuffer());
    const output = await recolorBackground(input);
    console.log(`  OK: ${objectPath} (${input.length} -> ${output.length} bytes)`);

    if (!dryRun) {
      const { error } = await supabaseServer.storage.from(BUCKET).upload(objectPath, output, {
        contentType: "image/webp",
        upsert: true,
      });
      if (error) {
        console.error(`  UPLOAD FAIL: ${objectPath}:`, error.message);
      } else {
        console.log(`  UPLOADED: ${publicUrl}`);
      }
    }
  }

  if (dryRun) {
    console.log("\n  To apply: DRY_RUN=false npx tsx --env-file=.env server/scripts/recolor-poll-option-backgrounds.ts\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
