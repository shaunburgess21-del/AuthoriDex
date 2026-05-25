import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTrackedByNameForInduction,
  inductionCandidateNameKey,
  resolveInductionCandidateAvatar,
  type TrackedRowForInductionAvatar,
} from "../server/services/induction-avatar-resolution";
import { resolvePersonAvatarCandidates } from "../server/services/person-avatar-urls";

test("inductionCandidateNameKey normalizes display names", () => {
  assert.equal(inductionCandidateNameKey("  Michael Jordan  "), "michael jordan");
});

test("buildTrackedByNameForInduction prefers induction status", () => {
  const rows: TrackedRowForInductionAvatar[] = [
    {
      name: "Michael Jordan",
      avatar: "https://cdn.example/main.jpg",
      imageSlug: "michael-jordan",
      status: "main_leaderboard",
    },
    {
      name: "Michael Jordan",
      avatar: "https://cdn.example/induction.jpg",
      imageSlug: "michael-jordan",
      status: "induction",
    },
  ];
  const map = buildTrackedByNameForInduction(rows);
  assert.equal(map.get("michael jordan")?.avatar, "https://cdn.example/induction.jpg");
  assert.equal(map.get("michael jordan")?.status, "induction");
});

test("resolveInductionCandidateAvatar uses curated URL before storage convention", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const tracked: TrackedRowForInductionAvatar = {
    name: "Michael Jordan",
    avatar: "https://example.supabase.co/storage/v1/object/public/public-images/curate-profile/abc/1.webp",
    imageSlug: "michael-jordan",
    status: "induction",
  };
  const url = resolveInductionCandidateAvatar(tracked, "michael-jordan");
  process.env.SUPABASE_URL = prev;
  assert.equal(
    url,
    "https://example.supabase.co/storage/v1/object/public/public-images/curate-profile/abc/1.webp",
  );
});

test("resolveInductionCandidateAvatar falls back to celebrity-large when no tracked row", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const url = resolveInductionCandidateAvatar(undefined, "scarlett-johansson");
  process.env.SUPABASE_URL = prev;
  assert.equal(
    url,
    "https://example.supabase.co/storage/v1/object/public/celebrity-large/scarlett-johansson/1.webp",
  );
});

test("resolvePersonAvatarCandidates orders stored avatar before convention slots", () => {
  const prev = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  const curated =
    "https://example.supabase.co/storage/v1/object/public/public-images/curate-profile/p1/99.webp";
  const candidates = resolvePersonAvatarCandidates(curated, "elon-musk");
  process.env.SUPABASE_URL = prev;
  assert.equal(candidates[0], curated);
  assert.match(candidates[1]!, /celebrity-large\/elon-musk\/1\.webp$/);
});
