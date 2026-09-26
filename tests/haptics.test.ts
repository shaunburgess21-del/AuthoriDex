import test from "node:test";
import assert from "node:assert/strict";

import {
  HAPTIC_SUCCESS_GAP_MS,
  configureHapticsForTests,
  haptic,
  hapticError,
  hapticGapElapsed,
  hapticSuccess,
  hapticSurface,
  resolveHapticCue,
} from "../client/src/lib/haptic";

test("only Android is a haptic surface", () => {
  assert.equal(hapticSurface(true, "android"), "android");
  assert.equal(hapticSurface(true, "ios"), "ios");
  assert.equal(hapticSurface(false, "android"), "web");
  assert.equal(hapticSurface(false, "web"), "web");
  assert.equal(hapticSurface(true, "web"), "web");
});

test("success on Android is one light impact; errors, taps, web, and iOS stay silent", () => {
  assert.equal(resolveHapticCue("android", "success"), "impact-light");
  assert.equal(resolveHapticCue("android", "error"), null);
  assert.equal(resolveHapticCue("android", "tap"), null);
  assert.equal(resolveHapticCue("ios", "success"), null);
  assert.equal(resolveHapticCue("web", "success"), null);
  assert.equal(resolveHapticCue("web", "error"), null);
});

test("the success gap collapses a second pulse and allows the next after it", () => {
  assert.equal(hapticGapElapsed(1_000, Number.NEGATIVE_INFINITY), true);
  assert.equal(hapticGapElapsed(1_000, 1_000), false);
  assert.equal(hapticGapElapsed(1_000 + HAPTIC_SUCCESS_GAP_MS - 1, 1_000), false);
  assert.equal(hapticGapElapsed(1_000 + HAPTIC_SUCCESS_GAP_MS, 1_000), true);
});

test("hapticSuccess pulses once on Android and swallows a plugin failure", async () => {
  let now = 10_000;
  const played: string[] = [];
  configureHapticsForTests({
    probe: () => ({ native: true, platform: "android" }),
    now: () => now,
    playImpact: async () => {
      played.push("light");
    },
  });

  hapticSuccess();
  hapticSuccess();
  hapticError();
  haptic(40);
  assert.deepEqual(played, ["light"]);

  now += HAPTIC_SUCCESS_GAP_MS;
  configureHapticsForTests({
    probe: () => ({ native: true, platform: "android" }),
    now: () => now,
    playImpact: async () => {
      throw new Error("vibrator unavailable");
    },
  });
  assert.doesNotThrow(() => hapticSuccess());

  configureHapticsForTests(null);
});

test("web, PWA, and iOS never call the haptics plugin", async () => {
  let played = 0;
  const playImpact = async () => {
    played += 1;
  };

  for (const probe of [
    () => ({ native: false, platform: "web" }),
    () => ({ native: false, platform: "android" }),
    () => ({ native: true, platform: "ios" }),
    () => {
      throw new Error("bridge missing");
    },
  ]) {
    configureHapticsForTests({ probe, playImpact });
    hapticSuccess();
    hapticError();
    haptic([10, 30, 10]);
  }

  assert.equal(played, 0);
  configureHapticsForTests(null);
});
