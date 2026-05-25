import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSON_OG_IMAGE_VERSION,
  personOgImagePath,
} from "@shared/person-og";
import { personOgDescription } from "../server/services/person-og-meta";
import {
  personConventionImageUrl,
  resolvePersonAvatarCandidates,
  resolvePersonAvatarUrl,
} from "../server/services/person-avatar-urls";
import {
  buildOverallRankPillSvg,
  buildPersonOgOverlaySvg,
  getPersonOgHeroLayout,
  getPersonOgOverlayLabels,
  getPersonOgWidgetLayout,
  overlayHasFullCanvasOpaqueFill,
  personOgUsesSiteDefaultFallback,
  PERSON_OG_NAME_FONT_SIZE,
  renderPersonOgImage,
  renderPersonOgImageJpeg,
  renderPersonOgUnavailableJpeg,
} from "../server/services/person-og-image";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";

test("personOgImagePath uses shared cache version v3", () => {
  assert.equal(PERSON_OG_IMAGE_VERSION, "3");
  assert.equal(
    personOgImagePath("elon-musk"),
    "/api/og/person/elon-musk.jpg?v=3",
  );
});

test("personOgImagePath uses trending person id from profile URL", () => {
  const uuid = "191aa3af-3c31-4e8a-87c2-3f8a2d07ae1c";
  assert.equal(
    personOgImagePath(uuid),
    `/api/og/person/${encodeURIComponent(uuid)}.jpg?v=3`,
  );
});

test("personOgDescription prefers shortBio", () => {
  assert.equal(
    personOgDescription({
      id: "elon-musk",
      name: "Elon Musk",
      category: "Tech",
      avatarUrl: null,
      imageSlug: null,
      avatarCandidates: [],
      rank: 3,
      trendScoreDisplay: "8,432",
      change24h: 2.1,
      change7d: -0.8,
      approvalDisplay: "4.2/5",
      shortBio: "Entrepreneur and CEO known for Tesla and SpaceX.",
      longBio: null,
      bio: null,
    }),
    "Entrepreneur and CEO known for Tesla and SpaceX.",
  );
});

test("resolvePersonAvatarCandidates tries 1-4.webp for slug", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const urls = resolvePersonAvatarCandidates(null, "elon-musk");
  process.env.SUPABASE_URL = prev;
  assert.equal(urls.length, 5);
  assert.match(urls[0]!, /\/elon-musk\/1\.webp$/);
  assert.match(urls[3]!, /\/elon-musk\/4\.webp$/);
  assert.match(urls[4]!, /\/celebrity_images\/elon-musk\/1\.png$/);
});

test("personOgUsesSiteDefaultFallback is false", () => {
  assert.equal(personOgUsesSiteDefaultFallback(), false);
});

test("resolvePersonAvatarUrl uses convention when stored empty", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = resolvePersonAvatarUrl(null, "elon-musk");
  process.env.SUPABASE_URL = prev;
  assert.equal(
    url,
    "https://example.supabase.co/storage/v1/object/public/celebrity-large/elon-musk/1.webp",
  );
});

test("personConventionImageUrl shape", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = personConventionImageUrl("taylor-swift");
  process.env.SUPABASE_URL = prev;
  assert.match(url!, /\/celebrity-large\/taylor-swift\/1\.webp$/);
});

const PLACEHOLDER_CTX = {
  id: "elon-musk",
  name: "Elon Musk",
  category: "Tech",
  avatarUrl: null,
  imageSlug: "elon-musk",
  avatarCandidates: [],
  rank: 12,
  trendScoreDisplay: "8,432",
  change24h: 2.1,
  change7d: -0.8,
  approvalDisplay: "4.2/5",
  shortBio: null,
  longBio: null,
  bio: null,
};

test("opentype path fonts load for person OG", () => {
  assert.ok(assertOgPathFontsLoaded());
});

test("getPersonOgHeroLayout is left-aligned 1:1 square to widgets", () => {
  const hero = getPersonOgHeroLayout();
  const widgets = getPersonOgWidgetLayout();
  const photoSize = widgets.widgetRowY - 8 - hero.contentTop;
  assert.equal(hero.heroX, 48);
  assert.equal(hero.heroY, 100);
  assert.equal(hero.heroWidth, photoSize);
  assert.equal(hero.heroHeight, photoSize);
  assert.equal(hero.heroWidth, 350);
});

test("buildPersonOgOverlaySvg has no full-canvas opaque background", () => {
  const svg = buildPersonOgOverlaySvg(PLACEHOLDER_CTX);
  assert.equal(overlayHasFullCanvasOpaqueFill(svg), false);
});

test("buildPersonOgOverlaySvg uses path outlines, rank pill, and four widgets", () => {
  const svg = buildPersonOgOverlaySvg(PLACEHOLDER_CTX);
  const labels = getPersonOgOverlayLabels(PLACEHOLDER_CTX);

  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  assert.equal(labels.name, PLACEHOLDER_CTX.name);
  assert.equal(labels.rank, "Overall #12");
  assert.equal(labels.change24h.label, "+2.1%");
  assert.ok(svg.includes('fill="#00C853"'), "positive 24h change uses green");
  assert.ok(svg.includes('fill-opacity="0.15"'));
  assert.ok(svg.includes('stroke-opacity="0.3"'));
  assert.ok(svg.includes('stroke="#fbbf24"'), "trophy icon stroke");
  assert.equal(PERSON_OG_NAME_FONT_SIZE, 56);
  const widgetCells = (svg.match(/rx="10" fill="#1e293b"/g) ?? []).length;
  assert.equal(widgetCells, 4, "four stat widget cells");
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 10, `expected >=10 path elements, got ${pathCount}`);
});

test("getPersonOgOverlayLabels uses New when rank missing", () => {
  const labels = getPersonOgOverlayLabels({ ...PLACEHOLDER_CTX, rank: null });
  assert.equal(labels.rank, "New");
});

test("buildOverallRankPillSvg renders amber pill with trophy paths", () => {
  const pill = buildOverallRankPillSvg(48, 228, "New");
  assert.ok(pill.includes('fill-opacity="0.15"'));
  assert.ok(pill.includes('stroke="#fbbf24"'));
  assert.ok((pill.match(/<path/g) ?? []).length >= 7, "label + trophy paths");
});

test("getPersonOgWidgetLayout fits four cells across 1200px", () => {
  const layout = getPersonOgWidgetLayout();
  const totalWidth =
    layout.widgetPadX * 2 +
    layout.widgetWidth * 4 +
    layout.widgetGap * 3;
  assert.ok(totalWidth <= 1200);
  assert.ok(layout.widgetWidth >= 260);
});

test("renderPersonOgImageJpeg returns 1200x630 JPEG under 600KB", async () => {
  const jpeg = await renderPersonOgImageJpeg(PLACEHOLDER_CTX);
  assert.ok(jpeg.length > 1000);
  const meta = await import("sharp").then((m) =>
    m.default(jpeg).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
  assert.ok(jpeg.length < 600_000);
});

test("renderPersonOgUnavailableJpeg returns JPEG not site default size", async () => {
  const jpeg = await renderPersonOgUnavailableJpeg();
  assert.ok(jpeg.length > 500);
  assert.ok(jpeg.length < 200_000, "unavailable card should be small, not 257KB default PNG");
});

test("renderPersonOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderPersonOgImage(PLACEHOLDER_CTX);
  const meta = await import("sharp").then((m) =>
    m.default(png).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});
