import test from "node:test";
import assert from "node:assert/strict";

import { isVoxDexHostedAvatarUrl } from "../client/src/lib/avatar/hosted";

const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const hostedPng = `https://example.supabase.co/storage/v1/object/public/avatars/${userId}/avatar.png?v=1`;
const hostedWebp = `https://example.supabase.co/storage/v1/object/public/avatars/${userId}/avatar.webp`;
const googlePhoto =
  "https://lh3.googleusercontent.com/a/avatar.png-not-really";

test("hosted generative and upload URLs", () => {
  assert.equal(isVoxDexHostedAvatarUrl(hostedPng, userId), true);
  assert.equal(isVoxDexHostedAvatarUrl(hostedWebp, userId), true);
});

test("rejects external and missing URLs", () => {
  assert.equal(isVoxDexHostedAvatarUrl(null, userId), false);
  assert.equal(isVoxDexHostedAvatarUrl(googlePhoto, userId), false);
  assert.equal(isVoxDexHostedAvatarUrl(hostedPng, "other-user-id"), false);
});

test("rejects avatar.png outside avatars bucket", () => {
  assert.equal(
    isVoxDexHostedAvatarUrl(
      "https://cdn.example.com/users/avatar.png",
      userId,
    ),
    false,
  );
});
