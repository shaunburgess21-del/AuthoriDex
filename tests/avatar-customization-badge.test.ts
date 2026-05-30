import test from "node:test";
import assert from "node:assert/strict";

import {
  isAvatarCustomizationEligible,
  type AvatarCustomizationCheckOpts,
} from "../shared/avatar-customization";

const completedAt = new Date("2026-01-01");

function base(
  overrides: Partial<AvatarCustomizationCheckOpts> = {},
): AvatarCustomizationCheckOpts {
  return {
    source: "settings",
    onboardingCompletedAt: completedAt,
    previousAvatarSeed: "user-1:default:v1",
    previousAvatarUrl: "https://cdn.example/avatars/user-1/avatar.png",
    newSeed: "user-1:pick:v2",
    newAvatarUrl: "https://cdn.example/avatars/user-1/avatar.png?v=2",
    ...overrides,
  };
}

test("onboarding source never eligible", () => {
  assert.equal(isAvatarCustomizationEligible(base({ source: "onboarding" })), false);
});

test("incomplete onboarding never eligible", () => {
  assert.equal(
    isAvatarCustomizationEligible(base({ onboardingCompletedAt: null })),
    false,
  );
});

test("generative re-pick with new seed is eligible", () => {
  assert.equal(isAvatarCustomizationEligible(base()), true);
});

test("generative save without seed change is not eligible", () => {
  assert.equal(
    isAvatarCustomizationEligible(
      base({
        newSeed: "user-1:default:v1",
        previousAvatarSeed: "user-1:default:v1",
      }),
    ),
    false,
  );
});

test("custom upload from generative png is eligible", () => {
  assert.equal(
    isAvatarCustomizationEligible(
      base({
        newSeed: null,
        newAvatarUrl: "https://cdn.example/avatars/user-1/avatar.webp?v=1",
      }),
    ),
    true,
  );
});

test("noop webp re-upload is not eligible", () => {
  const url = "https://cdn.example/avatars/user-1/avatar.webp?v=1";
  assert.equal(
    isAvatarCustomizationEligible(
      base({
        previousAvatarSeed: null,
        previousAvatarUrl: url,
        newSeed: null,
        newAvatarUrl: url,
      }),
    ),
    false,
  );
});

test("generative after prior upload is eligible even if seed matches pre-upload", () => {
  assert.equal(
    isAvatarCustomizationEligible(
      base({
        previousAvatarSeed: null,
        previousAvatarUrl: "https://cdn.example/avatars/user-1/avatar.webp",
        newSeed: "user-1:default:v1",
      }),
    ),
    true,
  );
});
