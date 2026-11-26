import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import {
  injectOgDocument,
  isOgDetailPath,
  ogHtmlPathForSpaPath,
  parseOgDocumentHtml,
  type OgDocumentMeta,
} from "../shared/og-document";

const SHELL = fs.readFileSync("client/index.html", "utf8");

const MATCHUP: OgDocumentMeta = {
  title: "Seal Team 6 vs Delta Force: Top tier one team? | VoxDex",
  description: "Delta Force leads with 57% of 7 votes. Seal Team 6 vs Delta Force.",
  canonicalUrl: "https://voxdex.com/vote/matchups/seal-team-6-vs-delta-force",
  imageUrl: "https://voxdex.com/api/og/vote/matchups/seal-team-6-vs-delta-force.png?v=12",
  imageType: "image/png",
};

const PREDICT: OgDocumentMeta = {
  title: "Michael Dell: Up or Down? | VoxDex",
  description: "UP 87% · DOWN 13% · Live market on Michael Dell",
  canonicalUrl: "https://voxdex.com/predict/updown/b8e77db3-7a25-4a90-bf51-e3be7f42997b",
  imageUrl: "https://voxdex.com/api/og/image/market.png?title=Michael%20Dell",
  imageType: "image/png",
};

const PERSON: OgDocumentMeta = {
  title: "Michael Dell | VoxDex",
  description: "Track Michael Dell on VoxDex.",
  canonicalUrl: "https://voxdex.com/person/b8e77db3-7a25-4a90-bf51-e3be7f42997b",
  imageUrl: "https://voxdex.com/api/og/person/b8e77db3-7a25-4a90-bf51-e3be7f42997b.png?v=4",
  imageType: "image/png",
};

test("detail paths are recognized and list pages are not", () => {
  assert.equal(isOgDetailPath("/vote/matchups/seal-team-6-vs-delta-force"), true);
  assert.equal(isOgDetailPath("/vote/opinion-polls/best-female-body-type"), true);
  assert.equal(isOgDetailPath("/polls/the-firing-of-jensen-huang"), true);
  assert.equal(isOgDetailPath("/predict/h2h/409c0607-4a61-41fe-909c-251063d9b012"), true);
  assert.equal(isOgDetailPath("/predict/updown/abc"), true);
  assert.equal(isOgDetailPath("/predict/race/abc"), true);
  assert.equal(isOgDetailPath("/markets/will-it-rain"), true);
  assert.equal(isOgDetailPath("/person/b8e77db3-7a25-4a90-bf51-e3be7f42997b"), true);
  assert.equal(isOgDetailPath("/celebrity/b8e77db3-7a25-4a90-bf51-e3be7f42997b"), true);
  assert.equal(isOgDetailPath("/share/bet/bet_123"), true);
  assert.equal(isOgDetailPath("/insights"), true);
  assert.equal(isOgDetailPath("/explore"), true);
  assert.equal(isOgDetailPath("/"), false);
  assert.equal(isOgDetailPath("/vote"), false);
  assert.equal(isOgDetailPath("/predict"), false);
  assert.equal(isOgDetailPath("/predict/activity"), false);
  assert.equal(
    ogHtmlPathForSpaPath("/vote/matchups/seal-team-6-vs-delta-force"),
    "/api/og/matchups/seal-team-6-vs-delta-force",
  );
  assert.equal(ogHtmlPathForSpaPath("/predict/race/abc"), "/api/og/predict/race/abc");
  assert.equal(
    ogHtmlPathForSpaPath("/person/abc"),
    "/api/og/person/abc",
  );
  assert.equal(
    ogHtmlPathForSpaPath("/explore"),
    "/api/og/insights?path=%2Fexplore",
  );
});

test("injectOgDocument gives the shell a unique title, canonical, png image, and JSON-LD", () => {
  const html = injectOgDocument(SHELL, MATCHUP);
  assert.match(html, /<title>Seal Team 6 vs Delta Force: Top tier one team\? \| VoxDex<\/title>/);
  assert.match(html, /rel="canonical" href="https:\/\/voxdex.com\/vote\/matchups\/seal-team-6-vs-delta-force"/);
  assert.match(html, /property="og:image" content="https:\/\/voxdex.com\/api\/og\/vote\/matchups\/seal-team-6-vs-delta-force\.png\?v=12"/);
  assert.match(html, /property="og:image:type" content="image\/png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /name="twitter:title" content="Seal Team 6 vs Delta Force: Top tier one team\? \| VoxDex"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type":"WebPage"/);
  assert.match(html, /Delta Force leads with 57%/);
  assert.match(html, /id="root"/);
  assert.match(html, /id="boot-shell"/);
  assert.match(
    html,
    /property="og:description" content="Delta Force leads with 57% of 7 votes\. Seal Team 6 vs Delta Force\."/,
  );
  assert.doesNotMatch(html, /Vox Populi - Indexed/);

  const other = injectOgDocument(SHELL, PREDICT);
  assert.match(other, /<title>Michael Dell: Up or Down\? \| VoxDex<\/title>/);
  assert.notEqual(
    other.match(/<title>[^<]+<\/title>/)?.[0],
    html.match(/<title>[^<]+<\/title>/)?.[0],
  );

  const profile = injectOgDocument(SHELL, PERSON);
  assert.match(profile, /<title>Michael Dell \| VoxDex<\/title>/);
  assert.match(profile, /property="og:image" content="https:\/\/voxdex.com\/api\/og\/person\/b8e77db3-7a25-4a90-bf51-e3be7f42997b\.png\?v=4"/);
});

test("homepage shell is unchanged when we do not inject", () => {
  assert.match(SHELL, /<title>VoxDex \| Vox Populi - Indexed<\/title>/);
  assert.match(SHELL, /rel="canonical" href="https:\/\/voxdex.com\/"/);
});

test("parseOgDocumentHtml round-trips a bot document", () => {
  const rendered = injectOgDocument(SHELL, MATCHUP);
  const parsed = parseOgDocumentHtml(rendered);
  assert.ok(parsed);
  assert.equal(parsed?.title, MATCHUP.title);
  assert.equal(parsed?.canonicalUrl, MATCHUP.canonicalUrl);
  assert.equal(parsed?.imageUrl, MATCHUP.imageUrl);
  assert.equal(parsed?.imageType, "image/png");
  assert.equal(parsed?.jsonLd?.["@type"], "WebPage");
});

test("missing image leaves the site default card in place", () => {
  const html = injectOgDocument(SHELL, {
    title: "VoxDex",
    description: "VoxDex turns the voice of the people into a living, real-time index. Vote, predict, and weigh in on the figures and topics shaping global conversation. — make your voice heard, one vote at a time.",
    canonicalUrl: "https://voxdex.com/markets/sa-only-card",
  });
  assert.match(html, /property="og:title" content="VoxDex"/);
  assert.match(html, /og-default\.png/);
  assert.doesNotMatch(html, /sa-only-card\.png/);
});
