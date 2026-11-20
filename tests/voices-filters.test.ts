import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EMPTY_VOICES_FILTERS } from "../client/src/components/voices/types";
import {
  VOICES_POST_TYPE_TOGGLES,
  applyFavourites,
  categoryFilterLabel,
  countActiveVoiceFilters,
  describeVoicesEmptyState,
  favouritePersonIds,
  parseVoicesQuery,
  shouldShowFavouritesChip,
  togglePostType,
  voiceFilterPersonSlots,
  voicesEmptyFilterSentence,
  voicesFilterButtonLabel,
  voicesSheetKeyboardOffset,
  writeVoicesQuery,
  type VoicesPostTypeToggle,
} from "../client/src/components/voices/voicesFilters";
import type { VoicesSurface } from "../shared/constants";

const polls = VOICES_POST_TYPE_TOGGLES.find((toggle) => toggle.id === "polls") as VoicesPostTypeToggle;
const matchup = VOICES_POST_TYPE_TOGGLES.find((toggle) => toggle.id === "matchup") as VoicesPostTypeToggle;

test("Polls toggle maps onto sentiment and opinion together", () => {
  assert.equal(polls.label, "Polls");
  assert.equal(polls.testId, "voices-post-type-polls");
  assert.deepEqual(polls.surfaces, ["sentiment_poll", "opinion_poll"]);
  assert.equal(matchup.label, "Head-to-head");

  const on = togglePostType([], polls.surfaces);
  assert.deepEqual(on, ["sentiment_poll", "opinion_poll"]);
  assert.deepEqual(togglePostType(on, polls.surfaces), []);
  assert.deepEqual(
    togglePostType(["sentiment_poll", "matchup"], polls.surfaces),
    ["matchup"],
  );
  assert.deepEqual(
    togglePostType(["matchup"], polls.surfaces),
    ["matchup", "sentiment_poll", "opinion_poll"],
  );
});

test("filter count treats Polls as one filter", () => {
  const pollsOn = togglePostType([], polls.surfaces);
  assert.equal(
    countActiveVoiceFilters({ surfaces: pollsOn, personIds: [], categories: [] }),
    1,
  );
  assert.equal(
    countActiveVoiceFilters({ surfaces: pollsOn, personIds: [], categories: ["music"] }),
    2,
  );
  assert.equal(voicesFilterButtonLabel(0), "Filter");
  assert.equal(voicesFilterButtonLabel(2), "Filter (2)");

  const everySurface = VOICES_POST_TYPE_TOGGLES.flatMap((toggle) => [...toggle.surfaces]);
  assert.equal(
    countActiveVoiceFilters({
      surfaces: everySurface as VoicesSurface[],
      personIds: ["p"],
      categories: ["music"],
    }),
    7,
  );

  const favourites = ["a", "b", "c"];
  assert.equal(
    countActiveVoiceFilters(
      { surfaces: [], personIds: favourites, categories: [] },
      { personCount: voiceFilterPersonSlots(favourites, favourites) },
    ),
    1,
  );
});

test("URL sync round-trips mode, surfaces, categories, personIds and keeps post", () => {
  assert.equal(
    writeVoicesQuery("", {
      mode: "latest",
      filters: { surfaces: ["matchup"], personIds: [], categories: [] },
    }),
    "?mode=latest&surfaces=matchup",
  );

  const state = {
    mode: "latest" as const,
    filters: {
      surfaces: ["sentiment_poll", "opinion_poll"] as VoicesSurface[],
      categories: ["music", "film-tv"],
      personIds: ["p1", "p2"],
    },
  };
  const qs = writeVoicesQuery("?post=abc&utm=newsletter", state);
  assert.equal(
    qs,
    "?mode=latest&surfaces=sentiment_poll,opinion_poll&categories=music,film-tv&personIds=p1,p2&post=abc&utm=newsletter",
  );
  assert.deepEqual(parseVoicesQuery(qs), state);
  assert.equal(writeVoicesQuery(qs, parseVoicesQuery(qs)), qs);

  const kept = writeVoicesQuery("?post=abc", {
    mode: "for-you",
    filters: EMPTY_VOICES_FILTERS,
  });
  assert.equal(kept, "?post=abc");
  assert.equal(parseVoicesQuery(kept).mode, "for-you");
  assert.deepEqual(parseVoicesQuery("?mode=nope&surfaces=matchup,bogus,matchup").filters.surfaces, ["matchup"]);
  assert.equal(parseVoicesQuery("?mode=top").mode, "top");
});

test("empty state names the active filters and keeps the unfiltered message", () => {
  assert.equal(
    voicesEmptyFilterSentence({
      postTypeLabels: ["Head-to-head"],
      personLabels: [],
      categoryLabels: ["Music"],
    }),
    "No Head-to-head posts about Music yet",
  );

  const filtered = describeVoicesEmptyState({
    filters: { surfaces: ["matchup"], personIds: [], categories: ["music"] },
    categoryLabel: (id) => categoryFilterLabel(id),
    personLabel: () => "Celebrity",
  });
  assert.equal(filtered.filtered, true);
  assert.equal(filtered.title, "No Head-to-head posts about Music yet");
  assert.equal(filtered.body, null);

  const renamed = describeVoicesEmptyState({
    filters: { surfaces: ["matchup"], personIds: [], categories: ["film-tv"] },
    categoryLabel: (id) => categoryFilterLabel(id, new Map([["film-tv", "Screen"]])),
    personLabel: () => "Celebrity",
  });
  assert.equal(renamed.title, "No Head-to-head posts about Screen yet");
  assert.equal(categoryFilterLabel("music"), "Music");
  assert.notEqual(categoryFilterLabel("film-tv"), "film-tv");
  assert.equal(categoryFilterLabel("film-tv"), "Film & TV");

  const plain = describeVoicesEmptyState({
    filters: EMPTY_VOICES_FILTERS,
    categoryLabel: (id) => id,
    personLabel: () => "Celebrity",
  });
  assert.equal(plain.filtered, false);
  assert.equal(plain.title, "No voices yet");
  assert.equal(plain.body, "Be the first to share a take with the Town Square.");

  assert.equal(
    describeVoicesEmptyState({
      filters: {
        surfaces: ["sentiment_poll", "opinion_poll", "matchup"],
        personIds: ["z"],
        categories: [],
      },
      categoryLabel: (id) => categoryFilterLabel(id),
      personLabel: () => "Zendaya",
      favouritesActive: true,
      favouriteIds: ["z"],
    }).title,
    "No Polls or Head-to-head posts about your favourites yet",
  );
});

test("favourites chip is signed-in only and sends at most 50 person ids", () => {
  assert.equal(shouldShowFavouritesChip(false, 4), false);
  assert.equal(shouldShowFavouritesChip(true, 0), false);
  assert.equal(shouldShowFavouritesChip(true, 2), true);

  const ids = Array.from({ length: 60 }, (_, index) => `id-${index}`);
  const capped = applyFavourites(ids);
  assert.equal(capped.length, 50);
  assert.equal(capped[0], "id-0");
  assert.equal(capped[49], "id-49");
  assert.deepEqual(favouritePersonIds(["a", "a", "b"]), ["a", "b"]);
});

test("sheet keyboard offset lifts the panel above the visual viewport", () => {
  assert.deepEqual(
    voicesSheetKeyboardOffset({ innerHeight: 800, viewportHeight: 480, viewportOffsetTop: 0 }),
    { bottom: 320, maxHeight: 464 },
  );
  assert.deepEqual(
    voicesSheetKeyboardOffset({ innerHeight: 800, viewportHeight: 800, viewportOffsetTop: 0 }),
    { bottom: 0, maxHeight: 784 },
  );
  assert.deepEqual(
    voicesSheetKeyboardOffset({ innerHeight: 800, viewportHeight: 500, viewportOffsetTop: 40 }),
    { bottom: 260, maxHeight: 484 },
  );
});

test("filter bar renders the Polls test hook inside a body portal", () => {
  const bar = readFileSync(
    new URL("../client/src/components/voices/VoicesFilterBar.tsx", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../client/src/pages/VoicesPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(bar, /data-testid=\{toggle\.testId\}/);
  assert.match(bar, /data-voices-filter-portal/);
  assert.doesNotMatch(bar, /VOICES_SURFACES/);
  assert.match(page, /writeVoicesQuery/);
  assert.match(page, /describeVoicesEmptyState/);
  assert.match(page, /Post the first take/);
  assert.match(page, /categoryFilterLabel/);
});
