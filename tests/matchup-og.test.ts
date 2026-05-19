import test from "node:test";
import assert from "node:assert/strict";

import {
  matchupOgDescription,
  matchupOgPromptTitle,
} from "../server/services/matchup-og-meta";
import {
  renderMatchupOgImage,
  renderMatchupOgImageJpeg,
} from "../server/services/matchup-og-image";
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
