import test from "node:test";
import assert from "node:assert/strict";

import { STREAK_REWARD_TEASE } from "../client/src/lib/streak-config";
import {
  backToSurfaceLabel,
  streakRewardTease,
  surfaceNoun,
} from "../client/src/lib/nativeCopy";

test("native shells say app and the website says site", () => {
  assert.equal(surfaceNoun(true), "app");
  assert.equal(surfaceNoun(false), "site");
});

test("the streak tease keeps the web sentence and swaps site for app on native", () => {
  assert.equal(streakRewardTease(false), "Take action on the site to earn Vox.");
  assert.equal(streakRewardTease(false), STREAK_REWARD_TEASE);
  assert.equal(streakRewardTease(true), "Take action on the app to earn Vox.");
});

test("the admin exit label says Site on web and App on a native shell", () => {
  assert.equal(backToSurfaceLabel(false), "Back to Site");
  assert.equal(backToSurfaceLabel(true), "Back to App");
});
