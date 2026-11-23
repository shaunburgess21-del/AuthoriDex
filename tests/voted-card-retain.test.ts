import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterCardsByVoteActivity, voteEyeBadgeCount } from "../client/src/lib/hub-activity-filter";
import {
  EMPTY_VOTED_RETAIN,
  cancelVotedCard,
  carouselIndexAfterRemoval,
  collapseVotedCard,
  dropRetainedCards,
  hideVotedCard,
  isVotedCardHidden,
  isVotedCardRetained,
  mixedFeedKeyForRetainKey,
  nextIntersectionWatch,
  retainVotedCard,
  scrollDeltaForRemovedSize,
  scrollTopToCenterCard,
  VOTED_CARD_RETURN_GAP_PX,
  shouldReturnToVotedCard,
  type LastVotedAnchor,
} from "../client/src/lib/voted-card-retain";

const cards = [
  { id: "voted", voted: true },
  { id: "open", voted: false },
];

describe("voted card retain and drop", () => {
  it("keeps a just-voted card in Not voted until it is hidden", () => {
    let state = retainVotedCard(EMPTY_VOTED_RETAIN, "sentiment:a");
    const retained = filterCardsByVoteActivity(
      cards,
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => (card.id === "voted" ? "sentiment:a" : "sentiment:b"),
        isRetained: (key) => isVotedCardRetained(state.phases[key]),
        isHidden: (key) => isVotedCardHidden(state.phases[key]),
      },
    );
    assert.deepEqual(retained.map((card) => card.id), ["voted", "open"]);

    state = collapseVotedCard(state, "sentiment:a");
    assert.equal(state.phases["sentiment:a"], "collapsing");
    const collapsing = filterCardsByVoteActivity(
      cards,
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => (card.id === "voted" ? "sentiment:a" : "sentiment:b"),
        isRetained: (key) => isVotedCardRetained(state.phases[key]),
        isHidden: (key) => isVotedCardHidden(state.phases[key]),
      },
    );
    assert.deepEqual(collapsing.map((card) => card.id), ["voted", "open"]);

    state = hideVotedCard(state, "sentiment:a");
    const hidden = filterCardsByVoteActivity(
      cards,
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => (card.id === "voted" ? "sentiment:a" : "sentiment:b"),
        isRetained: (key) => isVotedCardRetained(state.phases[key]),
        isHidden: (key) => isVotedCardHidden(state.phases[key]),
      },
    );
    assert.deepEqual(hidden.map((card) => card.id), ["open"]);
  });

  it("does not restart a card that is already collapsing or hidden", () => {
    const collapsing = collapseVotedCard(retainVotedCard(EMPTY_VOTED_RETAIN, "rating:1"), "rating:1");
    assert.equal(retainVotedCard(collapsing, "rating:1"), collapsing);
    const hidden = hideVotedCard(collapsing, "rating:1");
    assert.equal(retainVotedCard(hidden, "rating:1"), hidden);
    assert.equal(collapseVotedCard(hidden, "rating:1"), hidden);
  });

  it("cancels a rolled-back vote so the card is neither kept nor hidden", () => {
    const retained = retainVotedCard(EMPTY_VOTED_RETAIN, "opinion:9");
    const cleared = cancelVotedCard(retained, "opinion:9");
    assert.deepEqual(cleared, EMPTY_VOTED_RETAIN);
    const shown = filterCardsByVoteActivity(
      [{ id: "opinion:9", voted: false }],
      "hide-mine",
      (card) => card.voted,
      {
        keyOf: (card) => card.id,
        isRetained: (key) => isVotedCardRetained(cleared.phases[key]),
        isHidden: (key) => isVotedCardHidden(cleared.phases[key]),
      },
    );
    assert.deepEqual(shown.map((card) => card.id), ["opinion:9"]);
  });

  it("drops every held card when the filter or category changes", () => {
    const state = retainVotedCard(
      retainVotedCard(EMPTY_VOTED_RETAIN, "matchups:1"),
      "curate:2",
    );
    const collapsing = dropRetainedCards(state, "collapse");
    assert.equal(collapsing.phases["matchups:1"], "collapsing");
    assert.equal(collapsing.phases["curate:2"], "collapsing");
    const hidden = dropRetainedCards(collapsing, "hide");
    assert.equal(hidden.phases["matchups:1"], "hidden");
    assert.equal(hidden.phases["curate:2"], "hidden");
    assert.equal(dropRetainedCards(hidden, "hide"), hidden);
  });

  it("releases only after the card was on screen and then left", () => {
    assert.deepEqual(
      nextIntersectionWatch({ phase: "retained", wasVisible: false, isIntersecting: false }),
      { wasVisible: false, release: false },
    );
    assert.deepEqual(
      nextIntersectionWatch({ phase: "retained", wasVisible: false, isIntersecting: true }),
      { wasVisible: true, release: false },
    );
    assert.deepEqual(
      nextIntersectionWatch({ phase: "retained", wasVisible: true, isIntersecting: true }),
      { wasVisible: true, release: false },
    );
    assert.deepEqual(
      nextIntersectionWatch({ phase: "retained", wasVisible: true, isIntersecting: false }),
      { wasVisible: true, release: true },
    );
    assert.equal(
      nextIntersectionWatch({ phase: "collapsing", wasVisible: true, isIntersecting: false }).release,
      false,
    );
    assert.equal(
      nextIntersectionWatch({ phase: null, wasVisible: true, isIntersecting: false }).release,
      false,
    );
  });

  it("compensates scroll only when the removed card sat above the viewport", () => {
    assert.equal(
      scrollDeltaForRemovedSize({
        cardStart: -420,
        cardEnd: -20,
        viewportStart: 0,
        viewportEnd: 800,
        removed: 400,
      }),
      -400,
    );
    assert.equal(
      scrollDeltaForRemovedSize({
        cardStart: 900,
        cardEnd: 1300,
        viewportStart: 0,
        viewportEnd: 800,
        removed: 400,
      }),
      0,
    );
    assert.equal(
      scrollDeltaForRemovedSize({
        cardStart: 40,
        cardEnd: 440,
        viewportStart: 0,
        viewportEnd: 800,
        removed: 400,
      }),
      0,
    );
    assert.equal(
      scrollDeltaForRemovedSize({
        cardStart: -20,
        cardEnd: 10,
        viewportStart: 0,
        viewportEnd: 800,
        removed: 30,
      }),
      0,
    );
  });

  it("keeps the carousel slide the user is looking at when an earlier card drops", () => {
    assert.equal(
      carouselIndexAfterRemoval({ removedIndex: 1, activeIndex: 3, nextLength: 5 }),
      2,
    );
    assert.equal(
      carouselIndexAfterRemoval({ removedIndex: 4, activeIndex: 1, nextLength: 5 }),
      1,
    );
    assert.equal(
      carouselIndexAfterRemoval({ removedIndex: 0, activeIndex: 0, nextLength: 2 }),
      0,
    );
    assert.equal(
      carouselIndexAfterRemoval({ removedIndex: 0, activeIndex: 0, nextLength: 0 }),
      0,
    );
  });

  it("still lowers the Not voted eye count when the voted card is kept on screen", () => {
    const open = [{ voted: false }, { voted: false }, { voted: true }];
    assert.deepEqual(voteEyeBadgeCount("hide-mine", open), { count: 2, ownedCount: 1 });
    const afterVote = [{ voted: true }, { voted: false }, { voted: true }];
    assert.deepEqual(voteEyeBadgeCount("hide-mine", afterVote), { count: 1, ownedCount: 2 });
    assert.equal(voteEyeBadgeCount("show-mine", afterVote).count, 2);
  });
});

describe("last voted card anchor", () => {
  const anchor: LastVotedAnchor = {
    key: "matchups:m1",
    visitId: "visit-a",
    pendingReturn: true,
  };

  it("returns to the card when this visit switches to All or Votes only", () => {
    assert.equal(
      shouldReturnToVotedCard({
        anchor,
        visitId: "visit-a",
        previousFilter: "hide-mine",
        nextFilter: "all",
        cardInList: true,
      }),
      true,
    );
    assert.equal(
      shouldReturnToVotedCard({
        anchor,
        visitId: "visit-a",
        previousFilter: "hide-mine",
        nextFilter: "show-mine",
        cardInList: true,
      }),
      true,
    );
  });

  it("does not steal scroll on another visit, a later toggle, or a missing card", () => {
    assert.equal(
      shouldReturnToVotedCard({
        anchor,
        visitId: "visit-b",
        previousFilter: "hide-mine",
        nextFilter: "all",
        cardInList: true,
      }),
      false,
    );
    assert.equal(
      shouldReturnToVotedCard({
        anchor: { ...anchor, pendingReturn: false },
        visitId: "visit-a",
        previousFilter: "all",
        nextFilter: "show-mine",
        cardInList: true,
      }),
      false,
    );
    assert.equal(
      shouldReturnToVotedCard({
        anchor,
        visitId: "visit-a",
        previousFilter: "hide-mine",
        nextFilter: "all",
        cardInList: false,
      }),
      false,
    );
    assert.equal(
      shouldReturnToVotedCard({
        anchor,
        visitId: "visit-a",
        previousFilter: "all",
        nextFilter: "hide-mine",
        cardInList: true,
      }),
      false,
    );
    assert.equal(
      shouldReturnToVotedCard({
        anchor: null,
        visitId: "visit-a",
        previousFilter: "hide-mine",
        nextFilter: "all",
        cardInList: true,
      }),
      false,
    );
  });

  it("starts the return ring after the card has landed", () => {
    const session = readFileSync(
      new URL("../client/src/hooks/useVotedCardSession.ts", import.meta.url),
      "utf8",
    );
    const css = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");
    assert.equal(session.includes("setHighlightKey(anchor.key)"), false);
    assert.match(session, /armHighlight/);
    assert.match(css, /0 0 0 2px hsl\(var\(--primary\)\)/);
    assert.match(css, /voted-return-ring 1\.5s ease-out forwards/);
  });

  it("lands the card just under the sticky band with one shared gap", () => {
    assert.equal(VOTED_CARD_RETURN_GAP_PX, 8);
    const desktop = {
      scrollY: 2400,
      cardTop: 1800,
      cardHeight: 220,
      viewportHeight: 900,
      stickyTopPx: 64,
      bandHeightPx: 56,
    };
    const mobile = { ...desktop, stickyTopPx: 56, bandHeightPx: 48, viewportHeight: 700 };
    assert.equal(
      scrollTopToCenterCard(desktop),
      desktop.scrollY + desktop.cardTop - (desktop.stickyTopPx + desktop.bandHeightPx + VOTED_CARD_RETURN_GAP_PX),
    );
    assert.equal(
      scrollTopToCenterCard(mobile),
      mobile.scrollY + mobile.cardTop - (mobile.stickyTopPx + mobile.bandHeightPx + VOTED_CARD_RETURN_GAP_PX),
    );
    const centered =
      desktop.scrollY +
      desktop.cardTop -
      (desktop.stickyTopPx +
        desktop.bandHeightPx +
        (desktop.viewportHeight - desktop.stickyTopPx - desktop.bandHeightPx - desktop.cardHeight) / 2);
    assert.notEqual(scrollTopToCenterCard(desktop), Math.round(centered));
    assert.equal(
      scrollTopToCenterCard({
        scrollY: 10,
        cardTop: -200,
        cardHeight: 100,
        viewportHeight: 700,
        stickyTopPx: 64,
        bandHeightPx: 40,
      }),
      0,
    );
  });

  it("maps retain keys onto the mixed-feed window key", () => {
    assert.equal(mixedFeedKeyForRetainKey("matchups:abc"), "matchup:abc");
    assert.equal(mixedFeedKeyForRetainKey("sentiment:abc"), "sentiment:abc");
    assert.equal(mixedFeedKeyForRetainKey("opinion:abc"), "opinion:abc");
    assert.equal(mixedFeedKeyForRetainKey("rating:abc"), "rating:abc");
    assert.equal(mixedFeedKeyForRetainKey("curate:abc"), null);
    assert.equal(mixedFeedKeyForRetainKey("induction:abc"), null);
    assert.equal(mixedFeedKeyForRetainKey("market:abc"), null);
  });
});
