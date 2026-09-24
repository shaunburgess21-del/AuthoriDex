import test from "node:test";
import assert from "node:assert/strict";

import {
  ROOT_DESTINATIONS,
  decideNativeBack,
  isRootDestination,
  parentRouteFor,
} from "../client/src/lib/nativeBack";

test("root tabs with empty history exit", () => {
  for (const path of ROOT_DESTINATIONS) {
    assert.equal(isRootDestination(path), true);
    assert.deepEqual(decideNativeBack(path, false), { type: "exit" });
  }
});

test("root tabs with in-app history go back instead of exiting", () => {
  for (const path of ROOT_DESTINATIONS) {
    assert.deepEqual(decideNativeBack(path, true), { type: "back" });
  }
  assert.deepEqual(decideNativeBack("/vote?section=matchups", true), { type: "back" });
  assert.deepEqual(decideNativeBack("/insights?tab=crowd", false), { type: "exit" });
});

test("nested screens with history always pop, including deep links that were then navigated", () => {
  const nested = [
    "/vote/matchups/a-vs-b",
    "/vote/opinion-polls/topic",
    "/predict/updown/123",
    "/predict/h2h/456",
    "/predict/race/789",
    "/markets/some-market",
    "/person/taylor-swift",
    "/login",
    "/me/settings",
  ];
  for (const path of nested) {
    assert.deepEqual(decideNativeBack(path, true), { type: "back" });
  }
});

test("deep-linked nested routes with empty history replace to a parent and do not exit", () => {
  const cases: Array<[string, string]> = [
    ["/vote/matchups/a-vs-b", "/vote"],
    ["/vote/opinion-polls/topic", "/vote"],
    ["/vote/all-ratings", "/vote"],
    ["/vote/induction", "/vote"],
    ["/polls/some-poll", "/vote"],
    ["/predict/updown/123", "/predict"],
    ["/predict/h2h/456", "/predict"],
    ["/predict/race/789", "/predict"],
    ["/predict/activity", "/predict"],
    ["/markets/some-market", "/predict"],
    ["/predictions/leaderboard", "/predict"],
    ["/share/bet/abc", "/predict"],
    ["/person/taylor-swift", "/"],
    ["/celebrity/taylor-swift", "/"],
    ["/u/shaun", "/"],
    ["/profile", "/"],
    ["/login/verify", "/login"],
    ["/login/welcome", "/login"],
    ["/login", "/"],
    ["/me/settings", "/me"],
    ["/me/votes", "/me"],
    ["/me", "/"],
    ["/admin/suggestions", "/admin"],
    ["/admin", "/"],
    ["/explore", "/insights"],
    ["/terms", "/"],
    ["/how-it-works", "/"],
    ["/vote/matchups/a-vs-b?ref=1#top", "/vote"],
    ["/predict/updown/123/", "/predict"],
  ];

  for (const [path, parent] of cases) {
    assert.equal(parentRouteFor(path), parent);
    assert.deepEqual(decideNativeBack(path, false), { type: "replace", path: parent });
    assert.equal(isRootDestination(path), false);
  }
});

test("near-miss paths are not treated as root tabs", () => {
  for (const path of ["/votes", "/prediction", "/voice", "/insight", "/home"]) {
    assert.equal(isRootDestination(path), false);
    assert.deepEqual(decideNativeBack(path, false), { type: "replace", path: "/" });
  }
});
