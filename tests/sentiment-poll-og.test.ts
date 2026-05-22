import test from "node:test";
import assert from "node:assert/strict";

import {
  SENTIMENT_POLL_OG_IMAGE_VERSION,
  sentimentPollOgImagePath,
} from "@shared/sentiment-poll-og";
import { sentimentPollOgDescription } from "../server/services/sentiment-poll-og-meta";
import {
  resolveSentimentPollImageUrl,
  sentimentPollConventionImageUrl,
} from "../server/services/sentiment-poll-images";
import {
  buildSentimentPollOverlaySvg,
  getSentimentPollOverlayLabels,
  getSentimentPollVotePillLayout,
  renderSentimentPollOgImage,
  renderSentimentPollOgImageJpeg,
} from "../server/services/sentiment-poll-og-image";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";

test("sentimentPollOgImagePath uses shared cache version v3", () => {
  assert.equal(SENTIMENT_POLL_OG_IMAGE_VERSION, "3");
  assert.equal(
    sentimentPollOgImagePath("elon-musk-ai"),
    "/api/og/vote/polls/elon-musk-ai.jpg?v=3",
  );
});

test("sentimentPollOgDescription prefers subjectText", () => {
  assert.equal(
    sentimentPollOgDescription({
      slug: "test",
      headline: "Headline",
      subjectText: "Do you support this policy?",
      description: "Longer description",
      category: "politics",
      imageUrl: null,
    }),
    "Do you support this policy?",
  );
});

test("resolveSentimentPollImageUrl uses convention when stored empty", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = resolveSentimentPollImageUrl(null, "my-poll-slug");
  process.env.SUPABASE_URL = prev;
  assert.equal(
    url,
    "https://example.supabase.co/storage/v1/object/public/sentiment-polls/my-poll-slug/1.webp",
  );
});

test("sentimentPollConventionImageUrl shape", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = sentimentPollConventionImageUrl("climate-policy");
  process.env.SUPABASE_URL = prev;
  assert.match(url!, /\/sentiment-polls\/climate-policy\/1\.webp$/);
});

const PLACEHOLDER_CTX = {
  slug: "climate-policy",
  headline: "Should governments invest more in renewable energy?",
  subjectText: "Share your view on national climate policy.",
  description: null,
  category: "Politics",
  imageUrl: null,
};

test("opentype path fonts load for sentiment poll OG", () => {
  assert.ok(assertOgPathFontsLoaded());
});

test("buildSentimentPollOverlaySvg uses path outlines only", () => {
  const svg = buildSentimentPollOverlaySvg(PLACEHOLDER_CTX);
  const labels = getSentimentPollOverlayLabels(PLACEHOLDER_CTX);

  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  assert.equal(labels.headline, PLACEHOLDER_CTX.headline);
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 6, `expected >=6 path elements, got ${pathCount}`);

  const layout = getSentimentPollVotePillLayout();
  assert.ok(layout.VOTE_PILL_H > 70, `pill height ${layout.VOTE_PILL_H} expected >70`);
  const expectedH = Math.round(layout.VOTE_PILL_H);
  assert.ok(
    svg.includes(`height="${expectedH}"`),
    `SVG should include tall pill height ${expectedH}`,
  );
});

test("renderSentimentPollOgImageJpeg returns 1200x630 JPEG under 600KB", async () => {
  const jpeg = await renderSentimentPollOgImageJpeg(PLACEHOLDER_CTX);
  assert.ok(jpeg.length > 1000);
  const meta = await import("sharp").then((m) =>
    m.default(jpeg).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.ok(jpeg.length < 600_000);
});

test("renderSentimentPollOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderSentimentPollOgImage(PLACEHOLDER_CTX);
  const meta = await import("sharp").then((m) =>
    m.default(png).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});

async function nearWhiteFraction(
  jpeg: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(jpeg)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels ?? 3;
  const pixels = info.width * info.height;
  let nearWhite = 0;
  for (let i = 0; i < pixels; i++) {
    const idx = i * channels;
    const r = data[idx]!;
    const g = data[idx + 1] ?? r;
    const b = data[idx + 2] ?? r;
    if (r > 200 && g > 200 && b > 200) nearWhite++;
  }
  return nearWhite / pixels;
}

async function greenAccentFraction(
  jpeg: Buffer,
  region: { left: number; top: number; width: number; height: number },
): Promise<number> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(jpeg)
    .extract(region)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels ?? 3;
  const pixels = info.width * info.height;
  let green = 0;
  for (let i = 0; i < pixels; i++) {
    const idx = i * channels;
    const r = data[idx]!;
    const g = data[idx + 1] ?? r;
    const b = data[idx + 2] ?? r;
    if (g > 140 && g > r + 40 && g > b + 40) green++;
  }
  return green / pixels;
}

test("renderSentimentPollOgImageJpeg headline band has visible text", async () => {
  const jpeg = await renderSentimentPollOgImageJpeg(PLACEHOLDER_CTX);
  const frac = await nearWhiteFraction(jpeg, {
    left: 40,
    top: 450,
    width: 700,
    height: 80,
  });
  assert.ok(
    frac > 0.005,
    `headline near-white ${frac.toFixed(3)} too low`,
  );
});

test("renderSentimentPollOgImageJpeg vote pill row has visible text", async () => {
  const jpeg = await renderSentimentPollOgImageJpeg(PLACEHOLDER_CTX);
  const greenFrac = await greenAccentFraction(jpeg, {
    left: 48,
    top: 510,
    width: 360,
    height: 110,
  });
  const whiteFrac = await nearWhiteFraction(jpeg, {
    left: 400,
    top: 510,
    width: 360,
    height: 110,
  });
  assert.ok(
    greenFrac > 0.003 || whiteFrac > 0.003,
    `vote pills green ${greenFrac.toFixed(3)} white ${whiteFrac.toFixed(3)} too low`,
  );
});
