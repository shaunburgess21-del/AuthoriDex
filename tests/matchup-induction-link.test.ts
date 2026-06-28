import test from "node:test";
import assert from "node:assert/strict";

import {
  applyInductionMatchupSideLinks,
  inductionNameKey,
  resolveInductionMatchupSideLink,
  type InductionPersonMap,
} from "../server/services/matchup-person-link";

const NINJA_ID = "6973df91-d865-4538-97e2-837be68a0fbd";
const XQC_ID = "9bdc569b-4e86-44e6-b3b6-8b3159357248";

function sampleMap(): InductionPersonMap {
  return new Map([
    [inductionNameKey("Ninja"), NINJA_ID],
    [inductionNameKey("xQc"), XQC_ID],
    [inductionNameKey("  Casey Neistat  "), "casey-id"],
  ]);
}

test("inductionNameKey is case and whitespace insensitive", () => {
  assert.equal(inductionNameKey("  Ninja "), inductionNameKey("ninja"));
});

test("resolveInductionMatchupSideLink: exact induction name links and clears image", () => {
  const result = resolveInductionMatchupSideLink("Ninja", null, sampleMap());
  assert.equal(result.personId, NINJA_ID);
  assert.equal(result.clearImage, true);
  assert.equal(result.linked, true);
});

test("resolveInductionMatchupSideLink: non-induction name unchanged", () => {
  const result = resolveInductionMatchupSideLink("Shroud", null, sampleMap());
  assert.equal(result.personId, null);
  assert.equal(result.clearImage, false);
  assert.equal(result.linked, false);
});

test("resolveInductionMatchupSideLink: already linked correct id still clears image", () => {
  const result = resolveInductionMatchupSideLink("Ninja", NINJA_ID, sampleMap());
  assert.equal(result.personId, NINJA_ID);
  assert.equal(result.clearImage, true);
  assert.equal(result.linked, true);
});

test("resolveInductionMatchupSideLink: case-insensitive match", () => {
  const result = resolveInductionMatchupSideLink("ninja", null, sampleMap());
  assert.equal(result.personId, NINJA_ID);
  assert.equal(result.linked, true);
});

test("applyInductionMatchupSideLinks: mixed matchup leaves custom side untouched", () => {
  const bucketUrl = "https://example.supabase.co/storage/v1/object/public/matchups/ninja-vs-shroud/shroud.webp";
  const out = applyInductionMatchupSideLinks(
    {
      optionAText: "Ninja",
      optionBText: "Shroud",
      personAId: null,
      personBId: null,
      optionAImage: "https://example.com/old-ninja.webp",
      optionBImage: bucketUrl,
    },
    sampleMap(),
  );

  assert.equal(out.personAId, NINJA_ID);
  assert.equal(out.optionAImage, null);
  assert.equal(out.personBId, null);
  assert.equal(out.optionBImage, bucketUrl);
});

test("applyInductionMatchupSideLinks: clears image when manually linked non-induction person", () => {
  const edId = "1c14aa11-b080-4c03-befc-672177a32f47";
  const out = applyInductionMatchupSideLinks(
    {
      optionAText: "Ed Sheeran",
      optionBText: "Shroud",
      personAId: edId,
      personBId: null,
      optionAImage: "https://example.com/stale.webp",
      optionBImage: "https://example.com/shroud.webp",
    },
    sampleMap(),
  );

  assert.equal(out.personAId, edId);
  assert.equal(out.optionAImage, null);
  assert.equal(out.optionBImage, "https://example.com/shroud.webp");
});

test("applyInductionMatchupSideLinks: both induction sides linked and images cleared", () => {
  const out = applyInductionMatchupSideLinks(
    {
      optionAText: "Ninja",
      optionBText: "xQc",
      personAId: null,
      personBId: null,
      optionAImage: "https://example.com/a.webp",
      optionBImage: "https://example.com/b.webp",
    },
    sampleMap(),
  );

  assert.equal(out.personAId, NINJA_ID);
  assert.equal(out.personBId, XQC_ID);
  assert.equal(out.optionAImage, null);
  assert.equal(out.optionBImage, null);
});
