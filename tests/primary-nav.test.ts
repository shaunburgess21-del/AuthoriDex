import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { shouldApplyQuickVote, shouldApplyVoteUi } from "../client/src/lib/authReturn";
import {
  PRIMARY_NAV_ITEMS,
  buildRankingsSharePath,
  isPrimaryNavActive,
  leaderboardAliasTarget,
  legacyLeaderboardShareTarget,
  primaryNavKeyForPath,
} from "../client/src/lib/primaryNav";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("primary tabs are Vote, Rankings, Predict, Voices, Insights", () => {
  assert.deepEqual(
    PRIMARY_NAV_ITEMS.map((item) => [item.key, item.label, item.href]),
    [
      ["vote", "Vote", "/"],
      ["rankings", "Rankings", "/rankings"],
      ["predict", "Predict", "/predict"],
      ["voices", "Voices", "/voices"],
      ["insights", "Insights", "/insights"],
    ],
  );
});

test("vote covers / and /vote, rankings covers /rankings and /leaderboard", () => {
  const vote = [
    "/",
    "/?hint=hide",
    "/vote",
    "/vote/",
    "/vote?section=matchups",
    "/vote/matchups/a-vs-b",
    "/vote/opinion-polls/topic",
    "/vote/induction",
    "/vote/all-ratings",
  ];
  for (const path of vote) {
    assert.equal(primaryNavKeyForPath(path), "vote", path);
    assert.equal(isPrimaryNavActive("/", path), true, path);
    assert.equal(isPrimaryNavActive("/rankings", path), false, path);
  }

  for (const path of ["/rankings", "/rankings/", "/rankings?category=sports#leaderboard", "/leaderboard", "/leaderboard?category=sports"]) {
    assert.equal(primaryNavKeyForPath(path), "rankings", path);
    assert.equal(isPrimaryNavActive("/rankings", path), true, path);
    assert.equal(isPrimaryNavActive("/", path), false, path);
  }

  assert.equal(primaryNavKeyForPath("/predict"), "predict");
  assert.equal(primaryNavKeyForPath("/predict/updown/1"), "predict");
  assert.equal(primaryNavKeyForPath("/voices"), "voices");
  assert.equal(primaryNavKeyForPath("/insights?tab=crowd"), "insights");
  assert.equal(primaryNavKeyForPath("/person/ada"), null);
  assert.equal(isPrimaryNavActive("/predict", "/vote"), false);
});

test("old leaderboard shares redirect to /rankings and keep the query", () => {
  assert.equal(
    legacyLeaderboardShareTarget("/", "?category=sports&search=ada&sortDir=asc", "#leaderboard"),
    "/rankings?category=sports&search=ada&sortDir=asc#leaderboard",
  );
  assert.equal(legacyLeaderboardShareTarget("/", "", "#leaderboard"), "/rankings#leaderboard");
  assert.equal(legacyLeaderboardShareTarget("/", "?ref=VXABCDEF", ""), null);
  assert.equal(legacyLeaderboardShareTarget("/", "?hint=hide", ""), null);
  assert.equal(legacyLeaderboardShareTarget("/vote", "?category=sports", "#leaderboard"), null);
  assert.equal(legacyLeaderboardShareTarget("/rankings", "", "#leaderboard"), null);
});

test("/leaderboard alias keeps query and hash", () => {
  assert.equal(leaderboardAliasTarget("", ""), "/rankings");
  assert.equal(
    leaderboardAliasTarget("?category=sports&search=ada", "#leaderboard"),
    "/rankings?category=sports&search=ada#leaderboard",
  );
});

test("rankings share path is /rankings", () => {
  assert.equal(
    buildRankingsSharePath({ category: "all", searchQuery: "  ", sortDirection: "desc" }),
    "/rankings#leaderboard",
  );
  assert.equal(
    buildRankingsSharePath({ category: "sports", searchQuery: "ada", sortDirection: "asc" }),
    "/rankings?category=sports&search=ada&sortDir=asc#leaderboard",
  );
});

test("vote UI restores on the vote feed, quick vote also restores on rankings", () => {
  assert.equal(shouldApplyVoteUi("/"), true);
  assert.equal(shouldApplyVoteUi("/?hint=hide"), true);
  assert.equal(shouldApplyVoteUi("/vote/matchups/a"), true);
  assert.equal(shouldApplyVoteUi("/rankings"), false);
  assert.equal(shouldApplyQuickVote("/"), true);
  assert.equal(shouldApplyQuickVote("/vote"), true);
  assert.equal(shouldApplyQuickVote("/rankings?category=sports"), true);
  assert.equal(shouldApplyQuickVote("/predict"), false);
});

test("nav chrome, routes, and the leaderboard alias stay in sync", () => {
  const bottom = read("../client/src/components/BottomNav.tsx");
  const header = read("../client/src/components/SiteHeader.tsx");
  const app = read("../client/src/App.tsx");
  const vercel = read("../vercel.json");
  const express = read("../server/serve-static.ts");

  assert.match(bottom, /label: "Vote", icon: Home/);
  assert.match(bottom, /label: "Rankings", icon: Trophy/);
  assert.equal(bottom.includes('label: "Home"'), false);
  assert.ok(bottom.indexOf('label: "Vote"') < bottom.indexOf('label: "Rankings"'));
  assert.ok(bottom.indexOf('label: "Rankings"') < bottom.indexOf('label: "Predict"'));
  assert.match(bottom, /isPrimaryNavActive/);

  assert.match(header, /label: "Vote", href: "\/", testId: "nav-vote-desktop"/);
  assert.match(header, /label: "Rankings", href: "\/rankings", testId: "nav-rankings-desktop"/);
  assert.equal(header.includes('label: "Home"'), false);
  assert.equal(header.includes("nav-home-desktop"), false);

  assert.match(app, /<Route path="\/" component=\{VoteHomeRoute\} \/>/);
  assert.match(app, /<Route path="\/rankings" component=\{HomePage\} \/>/);
  assert.match(app, /<Route path="\/leaderboard" component=\{LeaderboardAliasRedirect\} \/>/);
  assert.match(app, /<Route path="\/vote" component=\{VotePage\} \/>/);
  assert.match(app, /<Route path="\/vote\/matchups\/:slug"/);
  assert.match(app, /<Route path="\/vote\/opinion-polls\/:slug"/);
  assert.match(app, /<Route path="\/vote\/induction"/);

  const vercelJson = JSON.parse(vercel) as {
    redirects: Array<{ source: string; destination: string }>;
    rewrites: Array<{ source: string; destination: string }>;
  };
  assert.ok(
    vercelJson.redirects.some((rule) => rule.source === "/leaderboard" && rule.destination === "/rankings"),
  );
  assert.ok(
    vercelJson.rewrites.some((rule) => rule.destination === "/index.html"),
  );
  assert.match(express, /req\.path !== "\/leaderboard"/);
  assert.match(express, /res\.redirect\(307, `\/rankings\$\{qs\}`\)/);
});
