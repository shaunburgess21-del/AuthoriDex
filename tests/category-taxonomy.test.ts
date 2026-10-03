import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalCategoryId,
  getCategoryBucketId,
  matchesCategoryFilter,
  normalizeMarketCategory,
} from "../shared/constants";
import {
  CATEGORY_REGISTRY_IDS,
  CATEGORY_REGISTRY_SEED,
  categoryRegistryFallback,
} from "../shared/category-registry";
import {
  canonicalVoteSlug,
  voteSlugLookupValues,
  VOTE_SLUG_REDIRECTS,
} from "../shared/vote-slug-redirects";

describe("canonical category ids", () => {
  it("maps labels and ids to the same taxonomy id", () => {
    assert.equal(canonicalCategoryId("tech"), "tech");
    assert.equal(canonicalCategoryId("Tech"), "tech");
    assert.equal(canonicalCategoryId("film-tv"), "film-tv");
    assert.equal(canonicalCategoryId("Film & TV"), "film-tv");
    assert.equal(canonicalCategoryId("food-drink"), "food-drink");
    assert.equal(canonicalCategoryId("Food & Drink"), "food-drink");
    assert.equal(canonicalCategoryId("media"), "media");
    assert.equal(canonicalCategoryId("Media & Podcast"), "media");
    assert.equal(canonicalCategoryId("media-and-podcast"), "media");
    assert.equal(canonicalCategoryId("science"), "science");
    assert.equal(canonicalCategoryId("Science"), "science");
    assert.equal(canonicalCategoryId("history"), "history");
    assert.equal(canonicalCategoryId("streaming"), "streaming");
  });

  it("matchesCategoryFilter accepts stored ids or labels", () => {
    assert.equal(matchesCategoryFilter("Tech", null, "tech"), true);
    assert.equal(matchesCategoryFilter("tech", null, "Tech"), true);
    assert.equal(matchesCategoryFilter("Film & TV", ["Music"], "film-tv"), true);
    assert.equal(matchesCategoryFilter("misc", ["film-tv"], "Film & TV"), true);
    assert.equal(matchesCategoryFilter("Media & Podcast", null, "media"), true);
    assert.equal(matchesCategoryFilter("media", null, "Media & Podcast"), true);
    assert.equal(matchesCategoryFilter("sports", ["Science"], "science"), true);
    assert.equal(matchesCategoryFilter("politics", null, "tech"), false);
  });

  it("normalizeMarketCategory still aliases entertainment → film-tv", () => {
    assert.equal(normalizeMarketCategory("entertainment"), "film-tv");
    assert.equal(getCategoryBucketId("Entertainment"), "film-tv");
  });
});

describe("category registry seed", () => {
  it("includes all 23 ids with unique sortOrder tens", () => {
    assert.equal(CATEGORY_REGISTRY_SEED.length, 23);
    assert.equal(CATEGORY_REGISTRY_IDS.length, 23);
    const ids = new Set(CATEGORY_REGISTRY_IDS);
    assert.equal(ids.size, 23);
    for (const extra of ["media", "streaming", "science", "history"]) {
      assert.ok(ids.has(extra), `missing ${extra}`);
    }
    const sortOrders = CATEGORY_REGISTRY_SEED.map((row) => row.sortOrder);
    assert.equal(new Set(sortOrders).size, 23);
    assert.ok(sortOrders.every((n) => n > 0 && n % 10 === 0));
  });

  it("API fallback is the same 23-id seed", () => {
    const fallback = categoryRegistryFallback();
    assert.deepEqual(
      fallback.map((row) => row.id),
      [...CATEGORY_REGISTRY_IDS],
    );
  });
});

describe("vote slug redirects", () => {
  it("maps typo slugs to the corrected spellings", () => {
    assert.equal(
      canonicalVoteSlug("the-most-poweful-person-on-earth"),
      "the-most-powerful-person-on-earth",
    );
    assert.equal(canonicalVoteSlug("perhero-fatigue-is-real"), "superhero-fatigue-is-real");
    assert.equal(canonicalVoteSlug("the-weekend-vs-bruno-mars"), "the-weeknd-vs-bruno-mars");
    assert.equal(
      canonicalVoteSlug("the-most-powerful-person-on-earth"),
      "the-most-powerful-person-on-earth",
    );
  });

  it("lookup accepts both typo and corrected slugs until the CMS edit", () => {
    const opinion = voteSlugLookupValues("the-most-powerful-person-on-earth");
    assert.ok(opinion.includes("the-most-poweful-person-on-earth"));
    assert.ok(opinion.includes("the-most-powerful-person-on-earth"));
    const sentiment = voteSlugLookupValues("perhero-fatigue-is-real");
    assert.ok(sentiment.includes("superhero-fatigue-is-real"));
    const matchup = voteSlugLookupValues("the-weeknd-vs-bruno-mars");
    assert.ok(matchup.includes("the-weekend-vs-bruno-mars"));
    assert.ok(matchup.includes("the-weeknd-vs-bruno-mars"));
    assert.equal(VOTE_SLUG_REDIRECTS.length, 3);
  });
});
