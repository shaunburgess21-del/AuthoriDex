import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterCardsByVoteActivity } from "../client/src/lib/hub-activity-filter";
import { voteHubSectionFromHash } from "../client/src/lib/voteHubDeepLinks";
import {
  restoresMixedFeedCard,
  voteDetailFeedCardKey,
  voteDetailListSearch,
  voteHubRestoreScrollPending,
  voteHubRestoreScrollTop,
  votePersonListSearch,
} from "../client/src/lib/voteListNavigation";
import {
  VOTE_ALL_SECTION_LAYOUT_MIN_PX,
  VOTE_FEED_CUE_LABELS,
  VOTE_SECTION_CUE_LABELS,
  applyVoteFeedFilters,
  distributeRatingTail,
  feedItemFillsRow,
  feedSpacerRows,
  interleaveVoteFeed,
  layoutFeedRows,
  matchesVoteFeedFilters,
  planFeedRestore,
  scrollYForFeedCard,
  voteFeedStickyOffset,
  separateShortRatingTail,
  snapFeedWindow,
  voteAllUsesMixedFeed,
  type VoteFeedFilterable,
} from "../client/src/lib/voteMixedFeed";

function card(
  id: string,
  extras: Partial<VoteFeedFilterable> = {},
): VoteFeedFilterable & { category?: string | null } {
  return {
    id,
    category: extras.category ?? "music",
    secondaryCategories: extras.secondaryCategories ?? [],
    searchText: extras.searchText ?? id,
    voted: extras.voted ?? false,
    favorite: extras.favorite ?? false,
  };
}

function kinds(feed: Array<{ kind: string }>): string[] {
  return feed.map((entry) => entry.kind);
}

describe("interleaveVoteFeed", () => {
  it("repeats matchup, sentiment, opinion, rating", () => {
    const feed = interleaveVoteFeed({
      matchup: [card("m1"), card("m2")],
      sentiment: [card("s1"), card("s2")],
      opinion: [card("o1"), card("o2")],
      rating: [card("r1"), card("r2")],
    });
    assert.deepEqual(kinds(feed), [
      "matchup",
      "sentiment",
      "opinion",
      "rating",
      "matchup",
      "sentiment",
      "opinion",
      "rating",
    ]);
    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["m1", "s1", "o1", "r1", "m2", "s2", "o2", "r2"],
    );
  });

  it("skips an exhausted type and still emits at most one rating per round", () => {
    const feed = interleaveVoteFeed({
      matchup: [card("m1"), card("m2"), card("m3")],
      sentiment: [card("s1")],
      opinion: [],
      rating: [card("r1"), card("r2"), card("r3"), card("r4"), card("r5")],
    });
    const lastOther = feed.findLastIndex((entry) => entry.kind !== "rating");
    const prefixEnd =
      lastOther >= 0 && feed[lastOther + 1]?.kind === "rating" ? lastOther + 2 : lastOther + 1;
    const prefix = feed.slice(0, prefixEnd);
    let ratingsInRound = 0;
    for (const entry of prefix) {
      if (entry.kind === "rating") {
        ratingsInRound += 1;
        assert.equal(ratingsInRound, 1);
      } else {
        ratingsInRound = 0;
      }
    }
    assert.deepEqual(
      prefix.map((entry) => entry.id),
      ["m1", "s1", "r1", "m2", "r2", "m3", "r3"],
    );
    assert.ok(feed.slice(prefix.length).every((entry) => entry.kind === "rating"));
  });

  it("does not place two ratings in a row while another type remains", () => {
    const feed = interleaveVoteFeed({
      matchup: [card("m1")],
      sentiment: [card("s1"), card("s2")],
      opinion: [card("o1")],
      rating: [card("r1"), card("r2"), card("r3"), card("r4")],
    });
    const lastOther = feed.findLastIndex((entry) => entry.kind !== "rating");
    for (let i = 1; i <= lastOther; i += 1) {
      if (feed[i].kind === "rating") {
        assert.notEqual(feed[i - 1].kind, "rating");
      }
    }
  });

  it("weaves a same-category rating tail instead of dumping source order", () => {
    const ratings = ["a", "b", "c", "d", "e", "f"].map((id) => card(id, { category: "music" }));
    const tail = distributeRatingTail(ratings, (item) => item.category);
    assert.deepEqual(
      tail.map((item) => item.id),
      ["a", "c", "e", "b", "d", "f"],
    );
    const order = ratings.map((item) => item.id);
    for (let i = 1; i < tail.length; i += 1) {
      const prev = order.indexOf(tail[i - 1].id);
      const next = order.indexOf(tail[i].id);
      assert.notEqual(Math.abs(prev - next), 1);
    }

    const feed = interleaveVoteFeed({
      matchup: [],
      sentiment: [],
      opinion: [],
      rating: ratings,
    });
    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["a", "c", "e", "b", "d", "f"],
    );
  });

  it("round-robins a mixed-category rating tail", () => {
    const ratings = [
      card("a1", { category: "music" }),
      card("a2", { category: "music" }),
      card("a3", { category: "music" }),
      card("b1", { category: "sports" }),
      card("b2", { category: "sports" }),
      card("c1", { category: "tech" }),
    ];
    const tail = distributeRatingTail(ratings, (item) => item.category);
    assert.deepEqual(
      tail.map((item) => item.id),
      ["a1", "b1", "c1", "a2", "b2", "a3"],
    );
  });

  it("does not leave a single leftover rating against the previous rating", () => {
    const feed = interleaveVoteFeed({
      matchup: [card("m1"), card("m2")],
      sentiment: [card("s1")],
      opinion: [card("o1")],
      rating: [card("r1"), card("r2"), card("r3")],
    });
    const kindsInOrder = kinds(feed);
    assert.ok(!(kindsInOrder.at(-1) === "rating" && kindsInOrder.at(-2) === "rating"));
    for (let i = 1; i < feed.length; i += 1) {
      assert.ok(!(feed[i].kind === "rating" && feed[i - 1].kind === "rating"));
    }
    assert.equal(feed.filter((entry) => entry.kind === "rating").length, 3);
  });

  it("keeps a long rating tail woven instead of pulling it apart", () => {
    const feed = interleaveVoteFeed({
      matchup: [card("m1")],
      sentiment: [],
      opinion: [],
      rating: [card("r1"), card("r2"), card("r3"), card("r4"), card("r5")],
    });
    const trailing = [];
    for (let i = feed.length - 1; i >= 0 && feed[i].kind === "rating"; i -= 1) {
      trailing.push(feed[i].id);
    }
    assert.ok(trailing.length > 2);
  });

  it("keeps source order for a short leftover tail", () => {
    const ratings = [card("r1", { category: "music" }), card("r2", { category: "music" })];
    assert.deepEqual(
      distributeRatingTail(ratings, (item) => item.category).map((item) => item.id),
      ["r1", "r2"],
    );
  });
});

describe("vote feed filters", () => {
  const items: VoteFeedFilterable[] = [
    card("open-music", { category: "music", searchText: "drake verse", voted: false, favorite: true }),
    card("voted-music", { category: "music", searchText: "drake encore", voted: true, favorite: false }),
    card("sports", { category: "sports", searchText: "messi final", voted: false, favorite: false }),
    card("secondary", {
      category: "tech",
      secondaryCategories: ["music"],
      searchText: "studio note",
      voted: false,
    }),
  ];

  it("keeps every card for all categories and all activity", () => {
    const result = applyVoteFeedFilters(items, { category: "all", search: "", activity: "all" });
    assert.deepEqual(result.map((item) => item.id), items.map((item) => item.id));
    const trending = applyVoteFeedFilters(items, { category: "trending", search: "", activity: "all" });
    assert.equal(trending.length, items.length);
  });

  it("filters by category, including a secondary category", () => {
    const result = applyVoteFeedFilters(items, { category: "music", search: "", activity: "all" });
    assert.deepEqual(
      result.map((item) => item.id),
      ["open-music", "voted-music", "secondary"],
    );
  });

  it("filters favorites independently of category text", () => {
    const result = applyVoteFeedFilters(items, { category: "favorites", search: "", activity: "all" });
    assert.deepEqual(result.map((item) => item.id), ["open-music"]);
  });

  it("matches search across the haystack, case-insensitive", () => {
    const result = applyVoteFeedFilters(items, { category: "all", search: "  DRAKE ", activity: "all" });
    assert.deepEqual(result.map((item) => item.id), ["open-music", "voted-music"]);
    assert.equal(
      matchesVoteFeedFilters(items[2], { category: "all", search: "drake", activity: "all" }),
      false,
    );
  });

  it("keeps only voted cards for votes only", () => {
    const result = applyVoteFeedFilters(items, { category: "all", search: "", activity: "show-mine" });
    assert.deepEqual(result.map((item) => item.id), ["voted-music"]);
  });

  it("keeps only unvoted cards for not voted", () => {
    const result = applyVoteFeedFilters(items, { category: "all", search: "", activity: "hide-mine" });
    assert.deepEqual(
      result.map((item) => item.id),
      ["open-music", "sports", "secondary"],
    );
  });

  it("uses a caller category matcher when one is provided", () => {
    const result = applyVoteFeedFilters(items, {
      category: "bucket-music",
      search: "",
      activity: "all",
      matchesCategory: (primary, secondary, category) =>
        category === "bucket-music" && (primary === "music" || (secondary ?? []).includes("music")),
    });
    assert.deepEqual(
      result.map((item) => item.id),
      ["open-music", "voted-music", "secondary"],
    );
  });

  it("applies category, search, and my-votes before interleave", () => {
    const matchups = [
      card("m-drake", { category: "music", searchText: "drake vs kendrick", voted: false }),
      card("m-messi", { category: "sports", searchText: "messi vs ronaldo", voted: false }),
      card("m-voted", { category: "music", searchText: "drake live", voted: true }),
    ];
    const sentiments = [
      card("s-drake", { category: "music", searchText: "drake headline", voted: false }),
      card("s-other", { category: "music", searchText: "unrelated", voted: false }),
    ];
    const opinions = [card("o-drake", { category: "music", searchText: "best drake album", voted: false })];
    const ratings = [
      card("r-drake", { category: "music", searchText: "drake", voted: false }),
      card("r-voted", { category: "music", searchText: "drake rated", voted: true }),
      card("r-other", { category: "sports", searchText: "drake mention", voted: false }),
    ];
    const filter = { category: "music", search: "drake", activity: "hide-mine" as const };
    const feed = interleaveVoteFeed({
      matchup: applyVoteFeedFilters(matchups, filter),
      sentiment: applyVoteFeedFilters(sentiments, filter),
      opinion: applyVoteFeedFilters(opinions, filter),
      rating: applyVoteFeedFilters(ratings, filter),
    });
    assert.deepEqual(
      feed.map((entry) => entry.id),
      ["m-drake", "s-drake", "o-drake", "r-drake"],
    );
  });

  it("keeps a just-voted card through hide-exit, then the mix drops it", () => {
    const matchups = [card("m1", { voted: true }), card("m2", { voted: false })];
    const retained = filterCardsByVoteActivity(
      applyVoteFeedFilters(matchups, { category: "all", search: "", activity: "all" }),
      "hide-mine",
      (item) => item.voted,
      { keyOf: (item) => `matchups:${item.id}`, isRetained: (key) => key === "matchups:m1" },
    );
    const hidden = filterCardsByVoteActivity(
      applyVoteFeedFilters(matchups, { category: "all", search: "", activity: "all" }),
      "hide-mine",
      (item) => item.voted,
      { keyOf: (item) => `matchups:${item.id}`, isHidden: (key) => key === "matchups:m1" },
    );
    const whileExiting = interleaveVoteFeed({
      matchup: retained,
      sentiment: [],
      opinion: [],
      rating: [],
    });
    const afterExit = interleaveVoteFeed({
      matchup: hidden,
      sentiment: [],
      opinion: [],
      rating: [],
    });
    assert.deepEqual(whileExiting.map((entry) => entry.id), ["m1", "m2"]);
    assert.deepEqual(afterExit.map((entry) => entry.id), ["m2"]);
  });
});

describe("vote feed layout", () => {
  it("gives each card its own row on mobile", () => {
    const layout = layoutFeedRows([2, 1, 1, 2], 1);
    assert.deepEqual(layout.rowOfIndex, [0, 1, 2, 3]);
    assert.equal(layout.rowCount, 4);
  });

  it("still packs a 2-column window when asked, which All no longer mounts", () => {
    const layout = layoutFeedRows([2, 1, 1, 2, 1], 2);
    assert.deepEqual(layout.rowOfIndex, [0, 1, 1, 2, 3]);
    assert.equal(layout.rowCount, 4);
    assert.equal(voteAllUsesMixedFeed(VOTE_ALL_SECTION_LAYOUT_MIN_PX), false);
  });

  it("snaps a 2-column window without splitting a row", () => {
    const spans = [2, 1, 1, 2, 1, 1] as const;
    const window = snapFeedWindow(spans, 3, 2, 2);
    assert.deepEqual(window, { start: 3, end: 6 });
    const spacers = feedSpacerRows(spans, window.start, window.end, 2);
    assert.deepEqual(spacers, { top: 2, bottom: 0 });
  });

  it("lets a lone card fill a 2-column row before the next matchup", () => {
    const spans = [2, 1, 1, 1, 2] as const;
    assert.equal(feedItemFillsRow(spans, 0, 2), true);
    assert.equal(feedItemFillsRow(spans, 1, 2), false);
    assert.equal(feedItemFillsRow(spans, 2, 2), false);
    assert.equal(feedItemFillsRow(spans, 3, 2), true);
    assert.equal(feedItemFillsRow(spans, 3, 1), false);
  });

  it("pages about 12 cards from the start", () => {
    const spans = Array.from({ length: 20 }, () => 1 as const);
    assert.deepEqual(snapFeedWindow(spans, 0, 1, 12), { start: 0, end: 12 });
  });
});

describe("mixed feed back to place", () => {
  const spans = Array.from({ length: 60 }, () => 1 as const);
  const keys = spans.map((_, index) => `matchup:card-${index}`);

  it("reveals a window that contains a card far past the first page", () => {
    const plan = planFeedRestore({
      keys,
      cardKey: "matchup:card-40",
      loading: false,
      spans,
      columns: 1,
    });
    assert.equal(plan.action, "reveal");
    assert.ok(plan.start <= 40);
    assert.ok(plan.end > 40);
    assert.ok(plan.end - plan.start <= 16);
  });

  it("waits while the lists are empty or still loading", () => {
    assert.equal(
      planFeedRestore({
        keys: [],
        cardKey: "matchup:card-40",
        loading: false,
        spans: [],
        columns: 1,
      }).action,
      "wait",
    );
    assert.equal(
      planFeedRestore({
        keys: keys.slice(0, 4),
        cardKey: "matchup:card-40",
        loading: true,
        spans: spans.slice(0, 4),
        columns: 2,
      }).action,
      "wait",
    );
  });

  it("gives up once the loaded list does not contain the card", () => {
    assert.equal(
      planFeedRestore({
        keys: keys.slice(0, 8),
        cardKey: "matchup:missing",
        loading: false,
        spans: spans.slice(0, 8),
        columns: 1,
      }).action,
      "abandon",
    );
    assert.equal(
      planFeedRestore({
        keys,
        cardKey: null,
        loading: false,
        spans,
        columns: 1,
      }).action,
      "abandon",
    );
  });

  it("scrolls the card to just under the sticky band", () => {
    assert.equal(scrollYForFeedCard(480, 1200, 128), 1544);
    assert.equal(scrollYForFeedCard(10, 0, 128), 0);
  });

  it("offsets a restore by the header plus the chip bar, ignoring a hidden bar", () => {
    assert.equal(voteFeedStickyOffset(64, 72), 136);
    assert.equal(voteFeedStickyOffset(0, 80), 80);
    assert.equal(voteFeedStickyOffset(Number.NaN, -4), 0);
  });

  it("moves a two-rating ending into an earlier gap", () => {
    const spread = separateShortRatingTail([
      { kind: "matchup" },
      { kind: "sentiment" },
      { kind: "rating" },
      { kind: "rating" },
    ]);
    assert.deepEqual(
      spread.map((entry) => entry.kind),
      ["matchup", "rating", "sentiment", "rating"],
    );
  });
});

describe("vote hub chip keys", () => {
  it("keeps deep links on the internal section keys", () => {
    assert.equal(voteHubSectionFromHash("#vote-matchups"), "Matchups");
    assert.equal(voteHubSectionFromHash("#vote-sentiment"), "Sentiment Polls");
    assert.equal(voteHubSectionFromHash("#vote-opinion"), "Opinion Polls");
    assert.equal(voteHubSectionFromHash("#vote-rating"), "Overall Rating");
    assert.equal(voteHubSectionFromHash("#vote-induction"), "Induction Queue");
    assert.equal(voteHubSectionFromHash("#vote-curate"), "Curate Profile");
    assert.equal(voteHubSectionFromHash("#vote-unknown"), null);
  });

  it("maps those keys to the cue words without renaming the keys", () => {
    assert.equal(VOTE_SECTION_CUE_LABELS.Matchups, "Head-to-head");
    assert.equal(VOTE_SECTION_CUE_LABELS["Sentiment Polls"], "Agree?");
    assert.equal(VOTE_SECTION_CUE_LABELS["Opinion Polls"], "Pick one");
    assert.equal(VOTE_SECTION_CUE_LABELS["Overall Rating"], "Rate");
    assert.equal(VOTE_FEED_CUE_LABELS.matchup, VOTE_SECTION_CUE_LABELS.Matchups);
    assert.equal(VOTE_SECTION_CUE_LABELS.All, undefined);
    assert.equal(VOTE_SECTION_CUE_LABELS["Induction Queue"], undefined);
  });
});

describe("desktop All uses stacked sections", () => {
  it("keeps the mixed feed below md and sections from 768px", () => {
    assert.equal(VOTE_ALL_SECTION_LAYOUT_MIN_PX, 768);
    assert.equal(voteAllUsesMixedFeed(390), true);
    assert.equal(voteAllUsesMixedFeed(767), true);
    assert.equal(voteAllUsesMixedFeed(768), false);
    assert.equal(voteAllUsesMixedFeed(1280), false);
    assert.equal(voteAllUsesMixedFeed(1440), false);
  });

  it("restores scroll position on desktop sections and a card key on the mix", () => {
    assert.equal(
      restoresMixedFeedCard({
        sectionLayout: true,
        activeSection: "All",
        feedCardKey: "matchup:1",
        storedCardKey: "matchup:1",
      }),
      false,
    );
    assert.equal(
      restoresMixedFeedCard({
        sectionLayout: false,
        activeSection: "All",
        feedCardKey: "matchup:1",
      }),
      true,
    );
    assert.equal(
      restoresMixedFeedCard({
        sectionLayout: false,
        activeSection: "Matchups",
        feedCardKey: "matchup:1",
      }),
      false,
    );
    assert.equal(
      voteDetailFeedCardKey({
        activeSection: "All",
        sectionLayout: true,
        cardKey: "matchup:1",
      }),
      undefined,
    );
    assert.equal(
      voteDetailFeedCardKey({
        activeSection: "All",
        sectionLayout: false,
        cardKey: "matchup:1",
      }),
      "matchup:1",
    );
    assert.equal(
      voteDetailListSearch({
        activeSection: "All",
        sectionLayout: true,
        mixedSearch: "mix",
        sectionSearch: "matchups",
      }),
      "matchups",
    );
    assert.equal(
      voteDetailListSearch({
        activeSection: "All",
        sectionLayout: false,
        mixedSearch: "mix",
        sectionSearch: "matchups",
      }),
      "mix",
    );
    assert.equal(
      votePersonListSearch({
        activeSection: "All",
        sectionLayout: true,
        mixedSearch: "mix",
        anchorHashId: "vote-rating",
        ratingSearch: "rated",
        inductionSearch: "",
        curateSearch: "",
      }),
      "rated",
    );
    assert.equal(voteHubRestoreScrollTop(2400, 400), 400);
    assert.equal(voteHubRestoreScrollTop(180, 2000), 180);
    assert.equal(voteHubRestoreScrollPending(2400, 400), true);
    assert.equal(voteHubRestoreScrollPending(180, 2000), false);
  });

  it("renders All as per-type sections on desktop and the mix only below md", () => {
    const vote = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
    const cards = readFileSync(new URL("../client/src/components/CardSection.tsx", import.meta.url), "utf8");
    assert.match(vote, /activeSection === "All" && !desktopSectionLayout && \([\s\S]*?<VoteMixedFeed/);
    assert.match(vote, /activeSection === "Sentiment Polls" \|\| showDesktopAllSections/);
    assert.match(vote, /activeSection === "Matchups" \|\| showDesktopAllSections/);
    assert.match(vote, /activeSection === "Opinion Polls" \|\| showDesktopAllSections/);
    assert.match(vote, /showDesktopAllSections && overallRatingSection/);
    const desktopRating = vote.indexOf("showDesktopAllSections && overallRatingSection");
    const shape = vote.indexOf('data-testid="shape-voxdex-sticky-scope"');
    const chipRating = vote.indexOf('activeSection === "Overall Rating" && overallRatingSection');
    assert.ok(desktopRating > 0 && desktopRating < shape, "Rate sits above Shape the VoxDex on desktop All");
    assert.ok(shape < chipRating, "the Rate chip still keeps its section under the Shape header");

    const matchupsAt = vote.indexOf('testId="section-header-matchups"');
    const matchupsEnd = vote.indexOf('data-testid="button-view-all-matchups"');
    const matchupsBlock = vote.slice(matchupsAt, matchupsEnd);
    assert.equal(matchupsBlock.includes("feedLayout"), false);
    assert.equal(matchupsBlock.includes("md:h-[32rem]"), false);
    assert.equal(matchupsBlock.includes("columns={"), false);
    assert.match(matchupsBlock, /desktopLimit=\{9\}/);
    assert.match(cards, /lg:grid-cols-3/);

    const sentimentAt = vote.indexOf('testId="section-header-sentiment"');
    const sentimentEnd = vote.indexOf('data-testid="button-view-all-topics"');
    assert.equal(vote.slice(sentimentAt, sentimentEnd).includes("feedLayout"), false);
    const opinionAt = vote.indexOf('testId="section-header-opinion"');
    const opinionEnd = vote.indexOf('data-testid="button-view-all-opinion-polls"');
    assert.equal(vote.slice(opinionAt, opinionEnd).includes("feedLayout"), false);
    const ratingAt = vote.indexOf('testId="section-header-rating"');
    const ratingEnd = vote.indexOf('data-testid="button-view-all-rating"');
    assert.equal(vote.slice(ratingAt, ratingEnd).includes("feedLayout"), false);
  });
});
