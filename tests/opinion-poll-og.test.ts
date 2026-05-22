import test from "node:test";
import assert from "node:assert/strict";

import {
  OPINION_POLL_OG_IMAGE_VERSION,
  opinionPollOgImagePath,
} from "@shared/opinion-poll-og";
import { opinionPollOgDescription } from "../server/services/opinion-poll-og-meta";
import {
  resolveOpinionPollImageUrl,
  opinionPollConventionImageUrl,
} from "../server/services/opinion-poll-images";
import {
  buildOpinionPollOverlaySvg,
  getOpinionPollOverlayLabels,
  renderOpinionPollOgImage,
  renderOpinionPollOgImageJpeg,
} from "../server/services/opinion-poll-og-image";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";

test("opinionPollOgImagePath uses shared cache version v1", () => {
  assert.equal(OPINION_POLL_OG_IMAGE_VERSION, "1");
  assert.equal(
    opinionPollOgImagePath("best-pizza-topping"),
    "/api/og/vote/opinion-polls/best-pizza-topping.jpg?v=1",
  );
});

test("opinionPollOgDescription prefers summary over description", () => {
  assert.equal(
    opinionPollOgDescription({
      slug: "test",
      title: "Best pizza topping?",
      summary: "Pick your favorite.",
      description: "Longer body copy.",
      category: "Food",
      imageUrl: null,
      displayOptions: [],
      overflowCount: 0,
    }),
    "Pick your favorite.",
  );
});

test("resolveOpinionPollImageUrl uses convention when stored empty", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = resolveOpinionPollImageUrl(null, "my-poll-slug");
  process.env.SUPABASE_URL = prev;
  assert.equal(
    url,
    "https://example.supabase.co/storage/v1/object/public/opinion-polls/my-poll-slug/1.webp",
  );
});

test("opinionPollConventionImageUrl shape", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = opinionPollConventionImageUrl("best-pizza");
  process.env.SUPABASE_URL = prev;
  assert.match(url!, /\/opinion-polls\/best-pizza\/1\.webp$/);
});

const BASE_CTX = {
  slug: "best-pizza-topping",
  title: "What is the best pizza topping?",
  summary: "Vote for your go-to slice topping.",
  description: null,
  category: "Food",
  imageUrl: null,
  displayOptions: [
    { name: "Pepperoni", orderIndex: 0 },
    { name: "Mushrooms", orderIndex: 1 },
    { name: "Extra cheese", orderIndex: 2 },
  ],
  overflowCount: 0,
};

const FIVE_OPTION_CTX = {
  ...BASE_CTX,
  displayOptions: [
    { name: "Option one", orderIndex: 0 },
    { name: "Option two", orderIndex: 1 },
    { name: "Option three", orderIndex: 2 },
    { name: "Option four", orderIndex: 3 },
    { name: "Option five", orderIndex: 4 },
  ],
  overflowCount: 2,
};

test("opentype path fonts load for opinion poll OG", () => {
  assert.ok(assertOgPathFontsLoaded());
});

test("buildOpinionPollOverlaySvg uses path outlines only", () => {
  const svg = buildOpinionPollOverlaySvg(BASE_CTX);
  const labels = getOpinionPollOverlayLabels(BASE_CTX);

  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  assert.equal(labels.title, BASE_CTX.title);
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 8, `expected >=8 path elements, got ${pathCount}`);
});

test("buildOpinionPollOverlaySvg includes overflow line when capped", () => {
  const svg = buildOpinionPollOverlaySvg(FIVE_OPTION_CTX);
  const labels = getOpinionPollOverlayLabels(FIVE_OPTION_CTX);

  assert.equal(labels.overflow, "+2 more");
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 12, `expected >=12 paths with overflow, got ${pathCount}`);
});

test("renderOpinionPollOgImageJpeg returns 1200x630 JPEG under 600KB", async () => {
  const jpeg = await renderOpinionPollOgImageJpeg(BASE_CTX);
  assert.ok(jpeg.length > 1000);
  const meta = await import("sharp").then((m) =>
    m.default(jpeg).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.ok(jpeg.length < 600_000);
});

test("renderOpinionPollOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderOpinionPollOgImage(BASE_CTX);
  const meta = await import("sharp").then((m) =>
    m.default(png).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});
