import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isVoteCardHiddenFromViewer } from "../shared/geoVisibility";
import {
  countryHeadersFromEdge,
  normalizeRequestCountryCode,
  pickViewerCountry,
  readIpCountry,
} from "../shared/viewerCountry";
import {
  isCountryScopedVoteFeed,
  isDirectVoteCardRead,
  voteDiscoveryCacheKey,
} from "../server/lib/voteFeedCache";

test("normalizeRequestCountryCode: uppercases ISO-2 and ignores unknown geo codes", () => {
  assert.equal(normalizeRequestCountryCode("za"), "ZA");
  assert.equal(normalizeRequestCountryCode("  us "), "US");
  assert.equal(normalizeRequestCountryCode(""), null);
  assert.equal(normalizeRequestCountryCode("   "), null);
  assert.equal(normalizeRequestCountryCode("XX"), null);
  assert.equal(normalizeRequestCountryCode("xx"), null);
  assert.equal(normalizeRequestCountryCode("T1"), null);
  assert.equal(normalizeRequestCountryCode("t1"), null);
  assert.equal(normalizeRequestCountryCode("USA"), null);
  assert.equal(normalizeRequestCountryCode("Z"), null);
  assert.equal(normalizeRequestCountryCode(null), null);
});

test("pickViewerCountry: residence wins over the IP header", () => {
  assert.equal(pickViewerCountry("gb", "ZA"), "GB");
  assert.equal(pickViewerCountry(" US ", "ZA"), "US");
  assert.equal(pickViewerCountry("ZA", null), "ZA");
});

test("pickViewerCountry: missing residence falls back to a valid IP country", () => {
  assert.equal(pickViewerCountry(null, "ZA"), "ZA");
  assert.equal(pickViewerCountry(undefined, "ZA"), "ZA");
  assert.equal(pickViewerCountry("", "ZA"), "ZA");
  assert.equal(pickViewerCountry("   ", "ZA"), "ZA");
});

test("readIpCountry: vercel header wins, invalid vercel falls through, cf is last", () => {
  assert.equal(
    readIpCountry({ "x-vercel-ip-country": "ZA", "cf-ipcountry": "US" }),
    "ZA",
  );
  assert.equal(
    readIpCountry({ "x-vercel-ip-country": "XX", "cf-ipcountry": "za" }),
    "ZA",
  );
  assert.equal(
    readIpCountry({ "x-vercel-ip-country": "", "x-voxdex-country": "ZA", "cf-ipcountry": "US" }),
    "ZA",
  );
  assert.equal(
    readIpCountry({ "x-vercel-ip-country": "T1", "cf-ipcountry": "T1" }),
    null,
  );
  assert.equal(readIpCountry({ "cf-ipcountry": "us" }), "US");
  assert.equal(readIpCountry({}), null);
});

test("countryHeadersFromEdge: stamps a real country and drops XX/T1/empty", () => {
  assert.deepEqual(countryHeadersFromEdge("za"), {
    "x-vercel-ip-country": "ZA",
    "x-voxdex-country": "ZA",
  });
  assert.equal(countryHeadersFromEdge("XX"), null);
  assert.equal(countryHeadersFromEdge("T1"), null);
  assert.equal(countryHeadersFromEdge(""), null);
  assert.equal(countryHeadersFromEdge(null), null);
});

test("direct vote-card reads are not country-gated", () => {
  assert.equal(isVoteCardHiddenFromViewer("direct", ["ZA"], null), false);
  assert.equal(isVoteCardHiddenFromViewer("direct", ["ZA"], "US"), false);
  assert.equal(isVoteCardHiddenFromViewer("direct", ["ZA"], "ZA"), false);
  assert.equal(isVoteCardHiddenFromViewer("feed", ["ZA"], null), true);
  assert.equal(isVoteCardHiddenFromViewer("feed", ["ZA"], "US"), true);
  assert.equal(isVoteCardHiddenFromViewer("feed", ["ZA"], "ZA"), false);
  assert.equal(isVoteCardHiddenFromViewer("feed", ["ZA"], "za"), false);
  assert.equal(isVoteCardHiddenFromViewer("feed", [], "US"), false);
  assert.equal(isVoteCardHiddenFromViewer("feed", ["ZA"], "US", true), false);
});

test("direct card routes and country-scoped feeds do not overlap", () => {
  const direct = [
    "/api/matchups/by-slug/springboks-vs-all-blacks",
    "/api/polls/springboks-win",
    "/api/opinion-polls/springbok-captain",
  ];
  const feeds = [
    "/api/matchups",
    "/api/trending-polls",
    "/api/opinion-polls",
    "/api/vote/starter-mix",
    "/api/insights/vote/top",
    "/api/me/favorites/dashboard",
  ];
  for (const path of direct) {
    assert.equal(isDirectVoteCardRead("GET", path), true, path);
    assert.equal(isCountryScopedVoteFeed("GET", path), false, path);
  }
  for (const path of feeds) {
    assert.equal(isCountryScopedVoteFeed("GET", path), true, path);
    assert.equal(isDirectVoteCardRead("GET", path), false, path);
  }
  assert.equal(isDirectVoteCardRead("POST", "/api/polls/springboks-win"), false);
  assert.equal(isCountryScopedVoteFeed("POST", "/api/matchups"), false);
  assert.equal(isDirectVoteCardRead("GET", "/api/opinion-polls/springbok-captain/suggestions"), false);
});

test("insights discover cache is keyed by viewer country", () => {
  assert.notEqual(
    voteDiscoveryCacheKey({ country: "ZA", bypass: false }),
    voteDiscoveryCacheKey({ country: "US", bypass: false }),
  );
  assert.equal(voteDiscoveryCacheKey({ country: null, bypass: false }), "vote:top:global");
  assert.equal(voteDiscoveryCacheKey({ country: "ZA", bypass: true }), "vote:top:staff");
  assert.equal(
    voteDiscoveryCacheKey({ country: "US", bypass: true }),
    voteDiscoveryCacheKey({ country: null, bypass: true }),
  );
});

test("slug detail handlers do not geo-404 a shared link", () => {
  const src = readFileSync(path.join(process.cwd(), "server/routes.ts"), "utf8");
  const slices = [
    sliceBetween(src, 'app.get("/api/matchups/by-slug/:slug"', 'app.get("/api/matchups/user-votes"'),
    sliceBetween(src, 'app.get("/api/polls/:slug"', 'app.post("/api/polls/:slug/vote"'),
    sliceBetween(src, 'app.get("/api/opinion-polls/:slug"', 'app.post("/api/opinion-polls/:slug/vote"'),
  ];
  for (const block of slices) {
    assert.equal(block.includes("assertCardVisibleForRead"), false);
    assert.equal(block.includes("GeoNotFoundError"), false);
  }
  assert.ok(src.includes("resolveUserGeoContext(req, VOTE_CARD_GEO)"));
  assert.ok(src.includes("resolveUserGeoContext(req as AuthRequest, VOTE_CARD_GEO)"));
});

function sliceBetween(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  const to = src.indexOf(end, from + start.length);
  assert.ok(to > from, `missing ${end}`);
  return src.slice(from, to);
}
