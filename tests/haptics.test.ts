import test from "node:test";
import assert from "node:assert/strict";

import {
  HAPTIC_SUCCESS_GAP_MS,
  configureHapticsForTests,
  haptic,
  hapticCueUsesGap,
  hapticError,
  hapticGapElapsed,
  hapticNotifySuccess,
  hapticSelection,
  hapticSuccess,
  hapticSurface,
  resolveHapticCue,
} from "../client/src/lib/haptic";

test("native shells are haptic surfaces and the website is not", () => {
  assert.equal(hapticSurface(true, "android"), "android");
  assert.equal(hapticSurface(true, "ios"), "ios");
  assert.equal(hapticSurface(false, "android"), "web");
  assert.equal(hapticSurface(false, "ios"), "web");
  assert.equal(hapticSurface(false, "web"), "web");
  assert.equal(hapticSurface(true, "web"), "web");
});

test("Android success is one light impact; iOS maps each cue and web stays silent", () => {
  assert.equal(resolveHapticCue("android", "success"), "impact-light");
  assert.equal(resolveHapticCue("android", "error"), null);
  assert.equal(resolveHapticCue("android", "tap"), null);
  assert.equal(resolveHapticCue("android", "selection"), null);
  assert.equal(resolveHapticCue("android", "notify-success"), null);

  assert.equal(resolveHapticCue("ios", "success"), "impact-light");
  assert.equal(resolveHapticCue("ios", "error"), "notification-error");
  assert.equal(resolveHapticCue("ios", "notify-success"), "notification-success");
  assert.equal(resolveHapticCue("ios", "selection"), "selection");
  assert.equal(resolveHapticCue("ios", "tap"), null);

  assert.equal(resolveHapticCue("web", "success"), null);
  assert.equal(resolveHapticCue("web", "error"), null);
  assert.equal(resolveHapticCue("web", "selection"), null);
  assert.equal(resolveHapticCue("web", "notify-success"), null);
});

test("confirmation cues share the gap and selection ticks do not", () => {
  assert.equal(hapticGapElapsed(1_000, Number.NEGATIVE_INFINITY), true);
  assert.equal(hapticGapElapsed(1_000, 1_000), false);
  assert.equal(hapticGapElapsed(1_000 + HAPTIC_SUCCESS_GAP_MS - 1, 1_000), false);
  assert.equal(hapticGapElapsed(1_000 + HAPTIC_SUCCESS_GAP_MS, 1_000), true);
  assert.equal(hapticCueUsesGap("impact-light"), true);
  assert.equal(hapticCueUsesGap("notification-error"), true);
  assert.equal(hapticCueUsesGap("notification-success"), true);
  assert.equal(hapticCueUsesGap("selection"), false);
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
  hapticNotifySuccess();
  hapticSelection();
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

test("iOS plays impact, notifications, and selection, and gaps confirmations", () => {
  let now = 20_000;
  const played: string[] = [];
  configureHapticsForTests({
    probe: () => ({ native: true, platform: "ios" }),
    now: () => now,
    play: async (cue) => {
      played.push(cue);
    },
  });

  hapticSuccess();
  hapticError();
  hapticSelection();
  hapticSelection();
  hapticNotifySuccess();
  assert.deepEqual(played, ["impact-light", "selection", "selection"]);

  now += HAPTIC_SUCCESS_GAP_MS;
  hapticError();
  hapticNotifySuccess();
  assert.deepEqual(played, [
    "impact-light",
    "selection",
    "selection",
    "notification-error",
  ]);

  now += HAPTIC_SUCCESS_GAP_MS;
  hapticNotifySuccess();
  haptic(10);
  assert.deepEqual(played, [
    "impact-light",
    "selection",
    "selection",
    "notification-error",
    "notification-success",
  ]);

  now += HAPTIC_SUCCESS_GAP_MS;
  configureHapticsForTests({
    probe: () => ({ native: true, platform: "ios" }),
    now: () => now,
    play: async () => {
      throw new Error("generator unavailable");
    },
  });
  assert.doesNotThrow(() => hapticError());

  configureHapticsForTests(null);
});

test("web and PWA never call the haptics plugin", () => {
  let played = 0;
  const play = async () => {
    played += 1;
  };

  for (const probe of [
    () => ({ native: false, platform: "web" }),
    () => ({ native: false, platform: "ios" }),
    () => ({ native: false, platform: "android" }),
    () => {
      throw new Error("bridge missing");
    },
  ]) {
    configureHapticsForTests({ probe, play });
    hapticSuccess();
    hapticError();
    hapticNotifySuccess();
    hapticSelection();
    haptic([10, 30, 10]);
  }

  assert.equal(played, 0);
  configureHapticsForTests(null);
});
