import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  buildMarketOgOverlaySvg,
  renderMarketOgImage,
  renderMarketOgImageJpeg,
  type MarketOgImageContext,
} from "../server/services/market-og-image";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";

const TESLA_CTX: MarketOgImageContext = {
  title: "Will the new Tesla Roaster have the ability to fly",
  categoryLabel: "Tech",
  imageUrl: null,
  chips: [
    { label: "Yes", pct: 50, accent: "up" },
    { label: "No", pct: 50, accent: "down" },
  ],
};

test("opentype path fonts load for market OG", () => {
  assert.ok(assertOgPathFontsLoaded());
});

test("buildMarketOgOverlaySvg uses path outlines only", () => {
  const svg = buildMarketOgOverlaySvg(TESLA_CTX);
  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 7, `expected >=7 path elements, got ${pathCount}`);
  assert.ok(svg.includes('id="bottomFade"'));
});

test("renderMarketOgImageJpeg returns 1200x630 JPEG under 600KB", async () => {
  const jpeg = await renderMarketOgImageJpeg(TESLA_CTX);
  assert.ok(jpeg.length > 1000);
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.equal(meta.format, "jpeg");
  assert.ok(jpeg.length < 600_000);
});

test("renderMarketOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderMarketOgImage(TESLA_CTX);
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

test("injected card image is visible through the overlay (not a blank gradient)", async () => {
  const hero = await sharp({
    create: {
      width: 800,
      height: 1000,
      channels: 3,
      background: { r: 220, g: 30, b: 30 },
    },
  })
    .png()
    .toBuffer();

  const jpeg = await renderMarketOgImageJpeg({
    ...TESLA_CTX,
    imageBuffer: hero,
  });

  // Mid-band of the 1200x630 canvas, above the title scrim.
  const { data, info } = await sharp(jpeg)
    .extract({ left: 200, top: 180, width: 800, height: 80 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels ?? 3;
  const pixels = info.width * info.height;
  let red = 0;
  for (let i = 0; i < pixels; i++) {
    const idx = i * channels;
    const r = data[idx]!;
    const g = data[idx + 1] ?? r;
    const b = data[idx + 2] ?? r;
    if (r > 140 && r > g + 40 && r > b + 40) red++;
  }
  assert.ok(
    red / pixels > 0.5,
    `expected the card image to show through, got red fraction ${(red / pixels).toFixed(3)}`,
  );
});
