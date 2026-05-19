import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  matchupOgDescription,
  matchupOgPromptTitle,
} from "../server/services/matchup-og-meta";
import {
  buildMatchupOverlaySvg,
  getMatchupOverlayLabels,
  renderMatchupOgImage,
  renderMatchupOgImageJpeg,
} from "../server/services/matchup-og-image";
import {
  assertOgFontAssetsPresent,
  FONT_SEARCH_PATHS,
  getOgFontFaceStyle,
} from "../server/services/og-fonts";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";
import {
  resolveMatchupOptionDisplay,
  matchupBucketUrl,
} from "../server/services/matchup-option-images";

test("matchupOgPromptTitle prefers promptText over title", () => {
  assert.equal(
    matchupOgPromptTitle({
      promptText: "Who is the GOAT?",
      title: "Football GOAT",
    }),
    "Who is the GOAT?",
  );
  assert.equal(
    matchupOgPromptTitle({ promptText: "  ", title: "Fallback title" }),
    "Fallback title",
  );
});

test("matchupOgDescription formats option names", () => {
  assert.equal(
    matchupOgDescription({
      optionAText: "Cristiano Ronaldo",
      optionBText: "Lionel Messi",
    }),
    "Cristiano Ronaldo vs Lionel Messi",
  );
});

test("resolveMatchupOptionDisplay: DB URL wins over bucket convention", () => {
  const dbUrl = "https://cdn.example.com/ronaldo.webp";
  const display = resolveMatchupOptionDisplay(
    dbUrl,
    null,
    "Cristiano Ronaldo",
    "Cristiano Ronaldo",
    "Lionel Messi",
    {},
    {},
  );
  assert.equal(display.resolved, dbUrl);
});

test("matchupBucketUrl builds public Supabase path shape", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = matchupBucketUrl(
    "Cristiano Ronaldo",
    "Lionel Messi",
    "Cristiano Ronaldo",
  );
  process.env.SUPABASE_URL = prev;
  assert.ok(url);
  assert.match(
    url!,
    /\/storage\/v1\/object\/public\/matchups\/cristiano-ronaldo-vs-lionel-messi\/cristiano-ronaldo\.webp$/,
  );
});

const PLACEHOLDER_CTX = {
  slug: "football-goat",
  title: "Football GOAT",
  promptText: "Who is the GOAT?",
  optionAText: "Cristiano Ronaldo",
  optionBText: "Lionel Messi",
  category: "Sports",
  optionAImageUrl: null,
  optionBImageUrl: null,
};

test("opentype path fonts load from bundled TTF", () => {
  assert.ok(assertOgPathFontsLoaded());
  assert.ok(assertOgFontAssetsPresent());
  assert.ok(FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir)));
});

test("buildMatchupOverlaySvg uses path outlines only (no librsvg text)", () => {
  const svg = buildMatchupOverlaySvg(PLACEHOLDER_CTX);
  const labels = getMatchupOverlayLabels(PLACEHOLDER_CTX);

  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  assert.ok(!svg.includes("@font-face"));

  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 6, `expected >=6 path elements, got ${pathCount}`);

  assert.equal(labels.prompt, "Who is the GOAT?");
  assert.equal(labels.cta, "Vote on VoxDex");
  assert.equal(labels.brand, "VoxDex");
});

test("getOgFontFaceStyle remains empty (matchup uses paths)", () => {
  assert.equal(getOgFontFaceStyle(), "");
});

test("renderMatchupOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderMatchupOgImage(PLACEHOLDER_CTX);
  assert.ok(png.length > 1000);
  const meta = await import("sharp").then((m) =>
    m.default(png).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test("renderMatchupOgImageJpeg returns 1200x630 JPEG under 600KB", async () => {
  const jpeg = await renderMatchupOgImageJpeg(PLACEHOLDER_CTX);
  assert.ok(jpeg.length > 1000);
  assert.ok(jpeg.length < 600_000, `expected <600KB, got ${jpeg.length}`);
  const meta = await import("sharp").then((m) =>
    m.default(jpeg).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.equal(meta.format, "jpeg");
});

/**
 * Tofu boxes in the VoxDex region are many uniform near-white rectangles;
 * path-outlined glyphs have more mid-tone edge pixels (lower near-white fraction).
 */
test("renderMatchupOgImageJpeg brand region is not tofu-like", async () => {
  const jpeg = await renderMatchupOgImageJpeg(PLACEHOLDER_CTX);
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(jpeg)
    .extract({ left: 40, top: 20, width: 180, height: 60 })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels ?? 3;
  const pixels = info.width * info.height;
  let nearWhite = 0;
  let midTone = 0;

  for (let i = 0; i < pixels; i++) {
    const idx = i * channels;
    const r = data[idx]!;
    const g = data[idx + 1] ?? r;
    const b = data[idx + 2] ?? r;
    if (r > 235 && g > 235 && b > 235) nearWhite++;
    if (r > 120 && r < 220 && g > 120 && g < 220 && b > 120 && b < 220) {
      midTone++;
    }
  }

  const nearWhiteFrac = nearWhite / pixels;
  const midToneFrac = midTone / pixels;

  assert.ok(
    nearWhiteFrac < 0.28,
    `near-white fraction ${nearWhiteFrac.toFixed(3)} too high (tofu?)`,
  );
  assert.ok(
    midToneFrac > 0.02,
    `mid-tone edge fraction ${midToneFrac.toFixed(3)} too low (missing glyphs?)`,
  );
});
