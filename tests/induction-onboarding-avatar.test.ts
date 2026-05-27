import test from "node:test";
import assert from "node:assert/strict";

import { resolvePostInductionAvatar } from "../server/services/induction-avatar-resolution";

const CURATED =
  "https://example.supabase.co/storage/v1/object/public/public-images/curate-profile/p1/1.webp";
const CELEB_LARGE =
  "https://example.supabase.co/storage/v1/object/public/celebrity-large/slug/1.webp";

test("resolvePostInductionAvatar prefers synced DB avatar over celebrity-large fallback", () => {
  const url = resolvePostInductionAvatar({
    hadCuratedImages: true,
    syncedAvatar: CURATED,
    primaryUrl: CELEB_LARGE,
    slugFallbackUrl: CELEB_LARGE,
  });
  assert.equal(url, CURATED);
});

test("resolvePostInductionAvatar does not use slug fallback when curated images existed", () => {
  const url = resolvePostInductionAvatar({
    hadCuratedImages: true,
    syncedAvatar: null,
    primaryUrl: null,
    slugFallbackUrl: CELEB_LARGE,
  });
  assert.equal(url, null);
});

test("resolvePostInductionAvatar uses primary or slug fallback when no curated images", () => {
  assert.equal(
    resolvePostInductionAvatar({
      hadCuratedImages: false,
      syncedAvatar: null,
      primaryUrl: CELEB_LARGE,
      slugFallbackUrl: null,
    }),
    CELEB_LARGE,
  );
  assert.equal(
    resolvePostInductionAvatar({
      hadCuratedImages: false,
      syncedAvatar: null,
      primaryUrl: null,
      slugFallbackUrl: CELEB_LARGE,
    }),
    CELEB_LARGE,
  );
});
