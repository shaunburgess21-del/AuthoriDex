import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { EMPTY_VOICES_FILTERS, type VoicesFeedMode, type VoicesFilters } from "../client/src/components/voices/types";
import {
  VOICES_POST_TYPE_TOGGLES,
  activePostTypeToggles,
  applyFavourites,
  categoryFilterLabel,
  countActiveVoiceFilters,
  describeVoicesEmptyState,
  emptyStateClearGesture,
  favouritePersonIds,
  nextVoicesHistoryAction,
  parseVoicesQuery,
  voicesFeedSearchParams,
  postTypeIsOn,
  postTypeToggleById,
  shouldShowFavouritesChip,
  togglePostType,
  voiceFilterPersonSlots,
  voicesEmptyFilterSentence,
  voicesFilterButtonLabel,
  voicesSheetKeyboardOffset,
  writeVoicesQuery,
  type VoicesHistoryAction,
  type VoicesPostTypeToggle,
} from "../client/src/components/voices/voicesFilters";
import type { VoicesSurface } from "../shared/constants";

const polls = postTypeToggleById("polls") as VoicesPostTypeToggle;
const matchup = postTypeToggleById("matchup") as VoicesPostTypeToggle;
const predictions = postTypeToggleById("world_market") as VoicesPostTypeToggle;

function chipIds(surfaces: readonly string[]): string[] {
  return activePostTypeToggles(surfaces).map((toggle) => toggle.id);
}

test("Polls toggle maps onto sentiment and opinion together", () => {
  assert.equal(polls.label, "Polls");
  assert.equal(polls.testId, "voices-post-type-polls");
  assert.deepEqual(polls.surfaces, ["sentiment_poll", "opinion_poll"]);
  assert.equal(predictions.label, "Predictions");
  assert.deepEqual(predictions.surfaces, ["world_market"]);
  assert.equal(matchup.label, "Head-to-head");

  const seen = new Map<string, string>();
  for (const toggle of VOICES_POST_TYPE_TOGGLES) {
    for (const surface of toggle.surfaces) {
      assert.equal(seen.has(surface), false, `${surface} is on both ${seen.get(surface)} and ${toggle.id}`);
      seen.set(surface, toggle.id);
    }
  }

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

test("Polls URL is only sentiment and opinion; world_market is Predictions", () => {
  const turnedOn = togglePostType([], polls.surfaces);
  assert.deepEqual(turnedOn, ["sentiment_poll", "opinion_poll"]);
  assert.equal(turnedOn.includes("world_market"), false);

  const pageSearch = writeVoicesQuery("", {
    mode: "for-you",
    filters: { surfaces: turnedOn, personIds: [], categories: [] },
  });
  assert.equal(pageSearch, "?surfaces=sentiment_poll,opinion_poll");
  const feed = voicesFeedSearchParams("for-you", {
    surfaces: turnedOn,
    personIds: [],
    categories: [],
  });
  assert.equal(new URLSearchParams(feed).get("surfaces"), "sentiment_poll,opinion_poll");
  assert.equal(feed.includes("world_market"), false);

  const pollsOnly = parseVoicesQuery(pageSearch);
  assert.deepEqual(chipIds(pollsOnly.filters.surfaces), ["polls"]);
  assert.equal(countActiveVoiceFilters(pollsOnly.filters), 1);
  assert.equal(postTypeIsOn(pollsOnly.filters.surfaces, predictions.surfaces), false);
  assert.equal(postTypeIsOn(pollsOnly.filters.surfaces, polls.surfaces), true);

  const predictionsOnly = parseVoicesQuery("?surfaces=world_market");
  assert.deepEqual(chipIds(predictionsOnly.filters.surfaces), ["world_market"]);
  assert.equal(countActiveVoiceFilters(predictionsOnly.filters), 1);
  assert.equal(postTypeIsOn(predictionsOnly.filters.surfaces, polls.surfaces), false);

  const both = parseVoicesQuery("?surfaces=sentiment_poll,opinion_poll,world_market");
  assert.deepEqual(chipIds(both.filters.surfaces), ["polls", "world_market"]);
  assert.equal(countActiveVoiceFilters(both.filters), 2);

  const partial = parseVoicesQuery("?surfaces=sentiment_poll");
  assert.deepEqual(chipIds(partial.filters.surfaces), ["polls"]);
  assert.equal(countActiveVoiceFilters(partial.filters), 1);
  assert.deepEqual(togglePostType(partial.filters.surfaces, polls.surfaces), []);

  const withPredictionsAlready = togglePostType(["world_market"], polls.surfaces);
  assert.deepEqual(withPredictionsAlready, ["world_market", "sentiment_poll", "opinion_poll"]);
  assert.deepEqual(chipIds(withPredictionsAlready), ["polls", "world_market"]);
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

test("committed filter changes push history; mobile panel defers until close", () => {
  let search = "";
  const stack = [search];
  let index = 0;
  let canonicalize = true;

  const boot = nextVoicesHistoryAction({
    currentSearch: search,
    mode: "for-you",
    filters: EMPTY_VOICES_FILTERS,
    canonicalize,
    defer: false,
  });
  assert.equal(boot.action, "none");
  canonicalize = false;

  const apply = (
    mode: VoicesFeedMode,
    filters: VoicesFilters,
    defer = false,
  ): VoicesHistoryAction => {
    const decision = nextVoicesHistoryAction({
      currentSearch: search,
      mode,
      filters,
      canonicalize,
      defer,
    });
    if (!defer) canonicalize = false;
    if (decision.action === "push") {
      stack.splice(index + 1);
      stack.push(decision.search);
      index += 1;
      search = decision.search;
    } else if (decision.action === "replace") {
      stack[index] = decision.search;
      search = decision.search;
    }
    return decision.action;
  };

  const back = () => {
    index = Math.max(0, index - 1);
    search = stack[index] ?? "";
    return parseVoicesQuery(search);
  };
  const forward = () => {
    index = Math.min(stack.length - 1, index + 1);
    search = stack[index] ?? "";
    return parseVoicesQuery(search);
  };

  assert.equal(apply("latest", EMPTY_VOICES_FILTERS), "push");
  assert.equal(search, "?mode=latest");

  const pollsOn = togglePostType([], polls.surfaces);
  assert.equal(
    apply("latest", { surfaces: pollsOn, personIds: [], categories: [] }),
    "push",
  );
  assert.equal(search, "?mode=latest&surfaces=sentiment_poll,opinion_poll");
  assert.equal(search.includes("world_market"), false);

  let restored = back();
  assert.equal(restored.mode, "latest");
  assert.deepEqual(restored.filters.surfaces, []);
  restored = back();
  assert.equal(restored.mode, "for-you");
  assert.deepEqual(restored.filters, EMPTY_VOICES_FILTERS);
  restored = forward();
  assert.equal(restored.mode, "latest");
  assert.deepEqual(restored.filters.surfaces, []);

  const beforePanel = index;
  assert.equal(
    apply("latest", { surfaces: ["matchup"], personIds: [], categories: [] }, true),
    "none",
  );
  assert.equal(
    apply("latest", { surfaces: ["matchup"], personIds: ["p1"], categories: ["music"] }, true),
    "none",
  );
  assert.equal(index, beforePanel);
  assert.equal(search, "?mode=latest");
  assert.equal(
    apply("latest", { surfaces: ["matchup"], personIds: ["p1"], categories: ["music"] }, false),
    "push",
  );
  assert.equal(index, beforePanel + 1);
  assert.equal(search, "?mode=latest&surfaces=matchup&categories=music&personIds=p1");
  restored = back();
  assert.equal(restored.mode, "latest");
  assert.deepEqual(restored.filters.surfaces, []);

  search = "?post=abc";
  stack.splice(0, stack.length, search);
  index = 0;
  canonicalize = false;
  assert.equal(apply("top", { surfaces: ["matchup"], personIds: [], categories: [] }), "push");
  assert.equal(search, "?mode=top&surfaces=matchup&post=abc");
  assert.equal(parseVoicesQuery(search).mode, "top");
  assert.equal(new URLSearchParams(search.slice(1)).get("post"), "abc");
});

test("first history sync replaces a non-canonical URL instead of pushing", () => {
  const decision = nextVoicesHistoryAction({
    currentSearch: "?mode=for-you&post=abc",
    mode: "for-you",
    filters: EMPTY_VOICES_FILTERS,
    canonicalize: true,
    defer: false,
  });
  assert.equal(decision.action, "replace");
  assert.equal(decision.search, "?post=abc");

  const same = nextVoicesHistoryAction({
    currentSearch: "?post=abc",
    mode: "for-you",
    filters: EMPTY_VOICES_FILTERS,
    canonicalize: false,
    defer: false,
  });
  assert.equal(same.action, "none");
});

test("clear filters commits on pointerdown before the composer can blur", () => {
  assert.deepEqual(emptyStateClearGesture({ type: "pointerdown", button: 0 }), {
    clear: true,
    preventFocusChange: true,
  });
  assert.deepEqual(emptyStateClearGesture({ type: "pointerdown", button: 2 }), {
    clear: false,
    preventFocusChange: false,
  });
  assert.deepEqual(emptyStateClearGesture({ type: "click" }), {
    clear: true,
    preventFocusChange: false,
  });
});

test("favourites chip follows ids from /api/me/favorites", () => {
  const idsFromPayload = (rows: Array<{ celebrityId?: string | null }>) =>
    favouritePersonIds(rows.map((row) => row.celebrityId ?? ""));
  assert.equal(shouldShowFavouritesChip(true, idsFromPayload([]).length), false);
  assert.equal(shouldShowFavouritesChip(true, idsFromPayload([{ celebrityId: "" }]).length), false);
  assert.equal(shouldShowFavouritesChip(true, idsFromPayload([{ celebrityId: null }]).length), false);
  assert.equal(shouldShowFavouritesChip(false, idsFromPayload([{ celebrityId: "p1" }]).length), false);
  assert.equal(shouldShowFavouritesChip(true, idsFromPayload([{ celebrityId: "p1" }]).length), true);
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

test("Favourites sits on the mode row and stays a personIds toggle", () => {
  const bar = readFileSync(
    new URL("../client/src/components/voices/VoicesFilterBar.tsx", import.meta.url),
    "utf8",
  );
  const page = readFileSync(
    new URL("../client/src/pages/VoicesPage.tsx", import.meta.url),
    "utf8",
  );
  const rowStart = bar.indexOf('data-testid="voices-mode-row"');
  const filterStart = bar.indexOf('data-testid="voices-filter-button"');
  const chipStart = bar.indexOf('data-testid="voices-favourites-chip"');
  assert.ok(rowStart >= 0 && chipStart > rowStart && chipStart < filterStart);
  assert.match(bar.slice(rowStart, filterStart), /Favourites/);
  assert.doesNotMatch(bar, /My favourites/);
  assert.match(bar, /modeTabClass\(mode === item\.id\)/);
  assert.match(bar, /modeTabClass\(favouritesActive\)/);
  assert.match(
    bar,
    /postTypeChips\.length > 0 \|\| visiblePeople\.length > 0 \|\| filters\.categories\.length > 0/,
  );
  assert.match(bar, /data-testid="voices-filter-count"/);
  assert.match(bar, /hidden sm:inline/);
  assert.match(page, /onToggleFavourites=\{toggleFavourites\}/);
  assert.match(page, /shouldShowFavouritesChip\(hasSession, favouriteIds\.length\)/);
  assert.doesNotMatch(page, /mode:\s*"favourites"/);
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
  const composer = readFileSync(
    new URL("../client/src/components/comments/CommentComposer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(bar, /data-testid=\{toggle\.testId\}/);
  assert.match(bar, /data-voices-filter-portal/);
  assert.match(bar, /postTypeToggleById\(toggle\.id\)/);
  assert.match(bar, /onHistoryDeferChange\?\.\(open && mobile\)/);
  assert.match(bar, /onChange=\{\(event\) => setQuery\(event\.target\.value\)\}/);
  assert.doesNotMatch(bar, /VOICES_SURFACES/);
  assert.match(page, /nextVoicesHistoryAction/);
  assert.match(page, /history\.pushState/);
  assert.match(page, /describeVoicesEmptyState/);
  assert.match(page, /Post the first take/);
  assert.match(page, /categoryFilterLabel/);
  assert.match(page, /shouldShowFavouritesChip\(hasSession, favouriteIds\.length\)/);
  assert.match(page, /emptyStateClearGesture/);
  assert.match(page, /data-keep-composer-focus/);
  assert.match(page, /data-testid="voices-feed-refresh"/);
  assert.match(page, /isPlaceholderData && "opacity-60 transition-opacity"/);
  assert.match(composer, /data-keep-composer-focus/);
});
