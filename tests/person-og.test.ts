import test from "node:test";
import assert from "node:assert/strict";

import {
  PERSON_OG_IMAGE_VERSION,
  personOgImagePath,
} from "@shared/person-og";
import { personOgDescription } from "../server/services/person-og-meta";
import {
  personConventionImageUrl,
  resolvePersonAvatarUrl,
} from "../server/services/person-images";
import {
  buildPersonOgOverlaySvg,
  getPersonOgOverlayLabels,
  getPersonOgWidgetLayout,
  renderPersonOgImage,
  renderPersonOgImageJpeg,
} from "../server/services/person-og-image";
import { assertOgPathFontsLoaded } from "../server/services/og-svg-text-paths";

test("personOgImagePath uses shared cache version v1", () => {
  assert.equal(PERSON_OG_IMAGE_VERSION, "1");
  assert.equal(
    personOgImagePath("elon-musk"),
    "/api/og/person/elon-musk.jpg?v=1",
  );
});

test("personOgDescription prefers shortBio", () => {
  assert.equal(
    personOgDescription({
      id: "elon-musk",
      name: "Elon Musk",
      category: "Tech",
      avatarUrl: null,
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

test("buildPersonOgOverlaySvg uses path outlines only with four widgets", () => {
  const svg = buildPersonOgOverlaySvg(PLACEHOLDER_CTX);
  const labels = getPersonOgOverlayLabels(PLACEHOLDER_CTX);

  assert.ok(!svg.includes("<text"));
  assert.ok(!svg.includes("font-family"));
  assert.equal(labels.name, PLACEHOLDER_CTX.name);
  assert.equal(labels.change24h.label, "+2.1%");
  assert.ok(svg.includes('fill="#00C853"'), "positive 24h change uses green");
  const widgetCells = (svg.match(/rx="10" fill="#1e293b"/g) ?? []).length;
  assert.equal(widgetCells, 4, "four stat widget cells");
  const pathCount = (svg.match(/<path/g) ?? []).length;
  assert.ok(pathCount >= 10, `expected >=10 path elements, got ${pathCount}`);
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

test("renderPersonOgImage returns 1200x630 PNG without remote images", async () => {
  const png = await renderPersonOgImage(PLACEHOLDER_CTX);
  const meta = await import("sharp").then((m) =>
    m.default(png).metadata(),
  );
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 630);
});
