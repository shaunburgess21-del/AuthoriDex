import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  matchupOgDescription,
  matchupOgPromptTitle,
} from "../server/services/matchup-og-meta";
import {
  buildMatchupOverlaySvg,
  renderMatchupOgImage,
  renderMatchupOgImageJpeg,
} from "../server/services/matchup-og-image";
import {
  assertOgFontAssetsPresent,
  assertOgFontsLoaded,
  FONT_SEARCH_PATHS,
  getOgFontFaceStyle,
  OG_FONT_FAMILY,
} from "../server/services/og-fonts";
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

test("getOgFontFaceStyle is empty (system-font mode for librsvg)", () => {
  assert.equal(getOgFontFaceStyle(), "");
  assert.ok(assertOgFontsLoaded());
});

test("bundled OG font assets exist for dist copy / nixpacks fallback", () => {
  assert.ok(assertOgFontAssetsPresent());
  assert.ok(FONT_SEARCH_PATHS.some((dir) => fs.existsSync(dir)));
});

test("buildMatchupOverlaySvg uses shared font stack", () => {
  const svg = buildMatchupOverlaySvg(PLACEHOLDER_CTX);
  assert.ok(svg.includes(OG_FONT_FAMILY));
  assert.ok(svg.includes("Who is the GOAT?"));
  assert.ok(svg.includes("Vote on VoxDex"));
  assert.ok(!svg.includes("@font-face"));
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

/** Bottom overlay band should have pixel variance when text renders (not flat tofu). */
test("renderMatchupOgImageJpeg text band has non-trivial pixel variance", async () => {
  const jpeg = await renderMatchupOgImageJpeg(PLACEHOLDER_CTX);
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(jpeg)
    .extract({
      left: 0,
      top: Math.floor(630 * 0.55),
      width: 1200,
      height: Math.floor(630 * 0.45),
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 1200);
  const channels = info.channels ?? 3;
  const samples = Math.min(5000, Math.floor(data.length / channels));
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const idx = i * channels;
    const lum =
      channels >= 3
        ? 0.299 * data[idx]! + 0.587 * data[idx + 1]! + 0.114 * data[idx + 2]!
        : data[idx]!;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / samples;
  const variance = sumSq / samples - mean * mean;
  assert.ok(
    variance > 50,
    `expected text band luminance variance >50, got ${variance.toFixed(1)} (tofu/flat?)`,
  );
});
