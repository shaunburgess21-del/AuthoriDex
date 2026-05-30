import test from "node:test";
import assert from "node:assert/strict";

import {
  ONBOARDING_WELCOME_PATH,
  shouldShowCelebrationToasts,
} from "../client/src/lib/onboarding-toasts";

const completedProfile = {
  onboardingCompletedAt: "2026-05-30T12:00:00.000Z",
};

test("no celebrations while profile incomplete", () => {
  assert.equal(shouldShowCelebrationToasts(null), false);
  assert.equal(shouldShowCelebrationToasts({ onboardingCompletedAt: null }), false);
});

test("celebrations after onboarding when not on welcome route", () => {
  assert.equal(shouldShowCelebrationToasts(completedProfile, "/"), true);
  assert.equal(shouldShowCelebrationToasts(completedProfile, "/markets"), true);
});

test("celebrations stay off on welcome route even when complete", () => {
  assert.equal(
    shouldShowCelebrationToasts(completedProfile, ONBOARDING_WELCOME_PATH),
    false,
  );
  assert.equal(
    shouldShowCelebrationToasts(completedProfile, `${ONBOARDING_WELCOME_PATH}/extra`),
    false,
  );
});

test("incomplete profile stays off welcome route too", () => {
  assert.equal(
    shouldShowCelebrationToasts({ onboardingCompletedAt: null }, "/"),
    false,
  );
});
