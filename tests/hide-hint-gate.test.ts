import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HIDE_HINT_CARDS_TO_PASS,
  HIDE_HINT_COOLDOWN_MS,
  HIDE_HINT_COPY,
  HIDE_HINT_ENTER_RATIO,
  HIDE_HINT_FORCE_STORAGE_KEY,
  HIDE_HINT_RECOMMENDATIONS_QUIET_MS,
  classifyHideHintIntersection,
  evaluateHideHintGate,
  hideHintTargetCard,
  initialHideHintScrollState,
  isHideHintFeedPath,
  isHideHintForced,
  markHideHintHasHidden,
  markHideHintShown,
  placeHideHintBubble,
  readHideHintHasHiddenFlag,
  reduceHideHintScroll,
  resetHideHintRecommendationsForTests,
  setHideHintRecommendations,
  getHideHintRecommendations,
  type HideHintGateInput,
  type HideHintScrollState,
  type HideHintStorage,
} from "../client/src/lib/hideHintGate";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function memoryStorage(seed?: Record<string, string>): HideHintStorage & { snapshot(): Record<string, string> } {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    snapshot: () => Object.fromEntries(map),
  };
}

function input(
  stores: { local: HideHintStorage; session: HideHintStorage },
  overrides: Partial<HideHintGateInput> = {},
): HideHintGateInput {
  return {
    signedIn: true,
    userId: "user-1",
    now: 1_700_000_000_000,
    search: "",
    hasHiddenCards: false,
    recommendationsOpen: false,
    recommendationsClosedAt: null,
    stores,
    ...overrides,
  };
}

function freshStores() {
  return { local: memoryStorage(), session: memoryStorage() };
}

/** First call records the intro session. A second store is a later visit. */
function returningStores(userId = "user-1") {
  const local = memoryStorage();
  const first = evaluateHideHintGate(input({ local, session: memoryStorage() }, { userId, now: 1_000 }));
  assert.equal(first.reason, "first-visit");
  return { local, session: memoryStorage() };
}

describe("hide hint feed routes", () => {
  it("only arms on the vote and predict hubs", () => {
    assert.equal(isHideHintFeedPath("/"), true);
    assert.equal(isHideHintFeedPath("/?hint=hide"), true);
    assert.equal(isHideHintFeedPath("/vote"), true);
    assert.equal(isHideHintFeedPath("/predict"), true);
    assert.equal(isHideHintFeedPath("/vote/"), true);
    assert.equal(isHideHintFeedPath("/predict?hint=hide"), true);
    assert.equal(isHideHintFeedPath("/vote/matchups/some-slug"), false);
    assert.equal(isHideHintFeedPath("/predict/updown/1"), false);
    assert.equal(isHideHintFeedPath("/rankings"), false);
    assert.equal(isHideHintFeedPath("/leaderboard"), false);
    assert.equal(isHideHintFeedPath("/me/hidden"), false);
  });
});

describe("hide hint testing override", () => {
  it("accepts the query param and the localStorage flag only", () => {
    const local = memoryStorage();
    assert.equal(isHideHintForced("", local), false);
    assert.equal(isHideHintForced("?hint=hide", local), true);
    assert.equal(isHideHintForced("hint=hide", local), true);
    assert.equal(isHideHintForced("?tab=all&hint=hide", local), true);
    assert.equal(isHideHintForced("?hint=show", local), false);
    local.setItem(HIDE_HINT_FORCE_STORAGE_KEY, "1");
    assert.equal(isHideHintForced("", local), true);
    local.setItem(HIDE_HINT_FORCE_STORAGE_KEY, "true");
    assert.equal(isHideHintForced("", local), false);
  });
});

describe("hide hint gate", () => {
  it("stays off for signed-out viewers, including when forced", () => {
    const stores = freshStores();
    stores.local.setItem(HIDE_HINT_FORCE_STORAGE_KEY, "1");
    const result = evaluateHideHintGate(input(stores, { signedIn: false, userId: null, search: "?hint=hide" }));
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "signed-out");
    assert.deepEqual(stores.local.snapshot(), { [HIDE_HINT_FORCE_STORAGE_KEY]: "1" });
  });

  it("records a first-seen marker and blocks the intro session", () => {
    const stores = freshStores();
    const first = evaluateHideHintGate(input(stores, { now: 50 }));
    assert.equal(first.eligible, false);
    assert.equal(first.reason, "first-visit");
    assert.equal(stores.local.snapshot()["voxdex_hide_hint_first_seen:user-1"], "50");
    assert.equal(stores.session.snapshot()["voxdex_hide_hint_intro_session:user-1"], "1");

    const later = evaluateHideHintGate(input(stores, { now: 5_000 }));
    assert.equal(later.reason, "first-visit");
  });

  it("allows a later session, keyed per user", () => {
    const { local, session } = returningStores("user-1");
    const ready = evaluateHideHintGate(input({ local, session }, { userId: "user-1", now: 9_000 }));
    assert.equal(ready.eligible, true);
    assert.equal(ready.reason, "eligible");

    const other = evaluateHideHintGate(
      input({ local, session: memoryStorage() }, { userId: "user-2", now: 9_000 }),
    );
    assert.equal(other.reason, "first-visit");
    assert.equal(local.snapshot()["voxdex_hide_hint_first_seen:user-2"], "9000");
  });

  it("shows at most once per 7 days", () => {
    const { local, session } = returningStores();
    markHideHintShown("user-1", 10_000, local);
    const during = evaluateHideHintGate(
      input({ local, session }, { now: 10_000 + HIDE_HINT_COOLDOWN_MS - 1 }),
    );
    assert.equal(during.reason, "cooldown");

    const after = evaluateHideHintGate(
      input({ local, session }, { now: 10_000 + HIDE_HINT_COOLDOWN_MS }),
    );
    assert.equal(after.eligible, true);
  });

  it("stops once this user has hidden a card", () => {
    const { local, session } = returningStores();
    const fromQuery = evaluateHideHintGate(input({ local, session }, { hasHiddenCards: true }));
    assert.equal(fromQuery.reason, "has-hidden");

    const flagged = returningStores("user-9");
    markHideHintHasHidden("user-9", flagged.local);
    assert.equal(readHideHintHasHiddenFlag("user-9", flagged.local), true);
    assert.equal(readHideHintHasHiddenFlag("user-1", flagged.local), false);
    const fromFlag = evaluateHideHintGate(
      input({ local: flagged.local, session: flagged.session }, { userId: "user-9" }),
    );
    assert.equal(fromFlag.reason, "has-hidden");
  });

  it("stays quiet while the recommendations drawer is open", () => {
    const { local, session } = returningStores();
    const open = evaluateHideHintGate(input({ local, session }, { recommendationsOpen: true }));
    assert.equal(open.eligible, false);
    assert.equal(open.reason, "recommendations");
  });

  it("stays quiet for about a minute after the drawer closes, then allows the hint", () => {
    const { local, session } = returningStores();
    const closedAt = 50_000;
    const during = evaluateHideHintGate(
      input({ local, session }, {
        now: closedAt + HIDE_HINT_RECOMMENDATIONS_QUIET_MS - 1,
        recommendationsClosedAt: closedAt,
      }),
    );
    assert.equal(during.reason, "recommendations");

    const after = evaluateHideHintGate(
      input({ local, session }, {
        now: closedAt + HIDE_HINT_RECOMMENDATIONS_QUIET_MS,
        recommendationsClosedAt: closedAt,
      }),
    );
    assert.equal(after.eligible, true);
    assert.equal(after.reason, "eligible");
  });

  it("lets the testing override skip frequency, first session, and has-hidden", () => {
    const stores = freshStores();
    stores.local.setItem(HIDE_HINT_FORCE_STORAGE_KEY, "1");
    markHideHintHasHidden("user-1", stores.local);
    markHideHintShown("user-1", 10_000, stores.local);
    const forced = evaluateHideHintGate(
      input(stores, { now: 10_000, hasHiddenCards: true, search: "" }),
    );
    assert.equal(forced.eligible, true);
    assert.equal(forced.reason, "forced");

    const byQuery = evaluateHideHintGate(
      input(freshStores(), { search: "?hint=hide", hasHiddenCards: true }),
    );
    assert.equal(byQuery.reason, "forced");
  });

  it("still defers to the recommendations drawer when forced, but skips the quiet window", () => {
    const stores = freshStores();
    const blocked = evaluateHideHintGate(
      input(stores, { search: "?hint=hide", recommendationsOpen: true }),
    );
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.reason, "recommendations");

    const closedAt = 50_000;
    const duringQuiet = evaluateHideHintGate(
      input(freshStores(), {
        search: "?hint=hide",
        now: closedAt + 1_000,
        recommendationsClosedAt: closedAt,
      }),
    );
    assert.equal(duringQuiet.eligible, true);
    assert.equal(duringQuiet.reason, "forced");
  });

  it("records when the drawer closes and does not latch that for the rest of the page", () => {
    resetHideHintRecommendationsForTests();
    setHideHintRecommendations({ open: true }, 1_000);
    setHideHintRecommendations({ open: false }, 2_000);
    assert.deepEqual(getHideHintRecommendations(), { open: false, closedAt: 2_000 });
    // A later update that is still closed must not refresh the timestamp
    // or stick a session-long flag.
    setHideHintRecommendations({ open: false }, 9_000);
    assert.deepEqual(getHideHintRecommendations(), { open: false, closedAt: 2_000 });
    setHideHintRecommendations({ open: true }, 10_000);
    assert.deepEqual(getHideHintRecommendations(), { open: true, closedAt: 2_000 });
    setHideHintRecommendations({ open: false }, 11_000);
    assert.deepEqual(getHideHintRecommendations(), { open: false, closedAt: 11_000 });
    resetHideHintRecommendationsForTests();
  });
});

describe("hide hint scroll streak", () => {
  function pass(state: HideHintScrollState, cardId: string): HideHintScrollState {
    return reduceHideHintScroll(reduceHideHintScroll(state, { type: "enter", cardId }), {
      type: "pass",
      cardId,
    });
  }

  it(`shows on the next in-view card after ${HIDE_HINT_CARDS_TO_PASS} have scrolled past`, () => {
    let state = initialHideHintScrollState();
    state = pass(state, "a");
    state = pass(state, "b");
    assert.equal(hideHintTargetCard(state), null);
    state = reduceHideHintScroll(state, { type: "enter", cardId: "c" });
    state = reduceHideHintScroll(state, { type: "enter", cardId: "d" });
    state = reduceHideHintScroll(state, { type: "pass", cardId: "c" });
    assert.equal(hideHintTargetCard(state), "d");
  });

  it("does not count a card that was never seen, or the same card twice", () => {
    let state = initialHideHintScrollState();
    state = reduceHideHintScroll(state, { type: "pass", cardId: "ghost" });
    assert.deepEqual(state.passed, []);
    state = pass(state, "a");
    state = reduceHideHintScroll(state, { type: "enter", cardId: "a" });
    state = reduceHideHintScroll(state, { type: "pass", cardId: "a" });
    assert.deepEqual(state.passed, ["a"]);
  });

  it("resets the streak on a vote and stops after the hint is consumed", () => {
    let state = initialHideHintScrollState();
    state = pass(state, "a");
    state = pass(state, "b");
    state = pass(state, "c");
    state = reduceHideHintScroll(state, { type: "enter", cardId: "d" });
    assert.equal(hideHintTargetCard(state), "d");

    state = reduceHideHintScroll(state, { type: "vote" });
    assert.equal(hideHintTargetCard(state), null);
    assert.deepEqual(state.passed, []);

    state = pass(state, "e");
    state = pass(state, "f");
    state = pass(state, "g");
    state = reduceHideHintScroll(state, { type: "enter", cardId: "h" });
    state = reduceHideHintScroll(state, { type: "consume" });
    assert.equal(hideHintTargetCard(state), null);
  });

  it("treats a fully exited seen card as scrolled past", () => {
    assert.equal(
      classifyHideHintIntersection({ isIntersecting: true, ratio: HIDE_HINT_ENTER_RATIO, wasVisible: false }),
      "enter",
    );
    assert.equal(
      classifyHideHintIntersection({ isIntersecting: true, ratio: HIDE_HINT_ENTER_RATIO - 0.1, wasVisible: false }),
      "ignore",
    );
    assert.equal(
      classifyHideHintIntersection({ isIntersecting: false, ratio: 0, wasVisible: true }),
      "pass",
    );
    assert.equal(
      classifyHideHintIntersection({ isIntersecting: true, ratio: 0.1, wasVisible: true }),
      "ignore",
    );
    assert.equal(
      classifyHideHintIntersection({ isIntersecting: false, ratio: 0, wasVisible: false }),
      "ignore",
    );
  });
});

describe("hide hint bubble placement", () => {
  it("fits a 320px viewport and stays off the vote buttons", () => {
    const placed = placeHideHintBubble({
      anchor: { top: 128, left: 232, width: 76, height: 22 },
      bubbleWidth: 216,
      bubbleHeight: 52,
      viewportWidth: 320,
      viewportHeight: 640,
      obstacles: [{ top: 520, left: 16, width: 288, height: 44 }],
      margin: 8,
    });

    assert.ok(placed.width <= 320 - 16);
    assert.ok(placed.left >= 8);
    assert.ok(placed.left + placed.width <= 320 - 8);
    assert.equal(placed.placement, "below");
    assert.ok(placed.top + 52 < 520);
    assert.ok(placed.arrowX >= 14 && placed.arrowX <= placed.width - 14);
  });

  it("flips above the chip when below would cover a vote button", () => {
    const placed = placeHideHintBubble({
      anchor: { top: 180, left: 200, width: 80, height: 22 },
      bubbleWidth: 200,
      bubbleHeight: 48,
      viewportWidth: 320,
      viewportHeight: 500,
      obstacles: [{ top: 200, left: 12, width: 296, height: 64 }],
      margin: 8,
    });
    assert.equal(placed.placement, "above");
    assert.ok(placed.top + 48 <= 200);
    assert.ok(placed.left + placed.width <= 312);
  });
});

describe("hide hint wiring", () => {
  it("uses the approved copy and keeps the hint off disabled chip menus", () => {
    assert.equal(HIDE_HINT_COPY, "Not your thing? Tap here to hide cards like this.");
    const pill = read("../client/src/components/InteractiveCategoryPill.tsx");
    assert.match(pill, /useHideHint\(\{[\s\S]*track: !menuDisabled && !!reactionTarget/);
    assert.match(pill, /HideHintBubble/);
    assert.match(pill, /pointer-events-none|HideHintChipGlow/);

    const bubble = read("../client/src/components/hide-hint/HideHintBubble.tsx");
    assert.match(bubble, /aria-live="polite"/);
    assert.match(bubble, /aria-hidden/);
    assert.match(bubble, /pointer-events-none/);
    assert.match(bubble, /createPortal/);
    assert.equal(bubble.includes("autoFocus"), false);

    const css = read("../client/src/index.css");
    assert.match(css, /\.hide-hint-chip-glow \{[^}]*animation: none !important/s);

    const app = read("../client/src/App.tsx");
    assert.match(app, /setHideHintRecommendations/);
    assert.match(app, /Want better recommendations/);

    const hide = read("../client/src/hooks/useHideCard.ts");
    assert.match(hide, /markHideHintHasHidden\(user\.id\)/);
    assert.match(hide, /noteHideHintCardHidden\(\)/);

    const toast = read("../client/src/lib/vote-toast.tsx");
    assert.match(toast, /noteHideHintVote\(\)/);
  });
});
