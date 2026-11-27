import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  PRACTICE_CARD_WAIT_MS,
  PREDICT_NAV_TEST_IDS,
  RANKINGS_NAV_TEST_IDS,
  WELCOME_TOUR_PENDING_KEY,
  WELCOME_TOUR_REAL_VOTE_LOGGED_KEY,
  WELCOME_TOUR_REAL_VOTE_PENDING_KEY,
  WELCOME_TOUR_SEEN_KEY,
  advanceTour,
  armTourRealVote,
  clearTourPending,
  consumeTourRealVote,
  currentTourStep,
  formatLivePercent,
  roundSplitTo100,
  lockDocumentScroll,
  pickVisibleId,
  placeBubble,
  practicePercentDataset,
  practiceRevealCopy,
  readPracticeSplit,
  readTourPending,
  readTourSeen,
  rectNeedsScroll,
  requestWelcomeTour,
  resetWelcomeTourBus,
  shouldAutoStartTour,
  shouldSkipPractice,
  startRunning,
  stepsForTour,
  subscribeTourRequest,
  takeTourRequest,
  tourNextLabel,
  tourReplayDestination,
  tourStepCopy,
  writeTourPending,
  writeTourSeen,
  type TourPhase,
  type TourStorage,
} from "../client/src/lib/welcomeTour";

function memory(initial: Record<string, string> = {}): TourStorage & { snapshot(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
    snapshot: () => ({ ...data }),
  };
}

function throwingStorage(): TourStorage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

const tourUi = readFileSync(new URL("../client/src/components/vote/WelcomeTour.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("../client/src/components/vote/WelcomeTourPreview.tsx", import.meta.url), "utf8");
const checklist = readFileSync(new URL("../client/src/components/vote/WelcomeChecklist.tsx", import.meta.url), "utf8");
const versus = readFileSync(new URL("../client/src/components/matchups/VersusCard.tsx", import.meta.url), "utf8");
const funnel = readFileSync(new URL("../client/src/lib/funnelTelemetry.ts", import.meta.url), "utf8");
const host = readFileSync(new URL("../client/src/components/quick-vote/QuickVoteHost.tsx", import.meta.url), "utf8");
const help = readFileSync(new URL("../client/src/components/help-chat/HelpChat.tsx", import.meta.url), "utf8");
const nudge = readFileSync(new URL("../client/src/components/AnonFirstVoteNudge.tsx", import.meta.url), "utf8");
const swipe = readFileSync(new URL("../client/src/components/vote/MatchupCategorySwipe.tsx", import.meta.url), "utf8");
const menu = readFileSync(new URL("../client/src/components/UserMenu.tsx", import.meta.url), "utf8");

describe("welcome tour seen state", () => {
  it("stays unseen until skip or completion writes the device flag", () => {
    const store = memory();
    assert.equal(readTourSeen(store), false);
    assert.equal(shouldAutoStartTour(), false);
    writeTourSeen(store);
    assert.equal(readTourSeen(store), true);
    assert.equal(store.getItem(WELCOME_TOUR_SEEN_KEY), "1");
    assert.equal(shouldAutoStartTour(), false);
  });

  it("ignores storage that throws", () => {
    const store = throwingStorage();
    assert.equal(readTourSeen(store), false);
    assert.doesNotThrow(() => writeTourSeen(store));
    assert.doesNotThrow(() => armTourRealVote(store));
    assert.equal(consumeTourRealVote(store), false);
  });

  it("logs the first real vote once, and only after a tour has started", () => {
    const store = memory();
    assert.equal(consumeTourRealVote(store), false);
    armTourRealVote(store);
    assert.equal(store.getItem(WELCOME_TOUR_REAL_VOTE_PENDING_KEY), "1");
    assert.equal(consumeTourRealVote(store), true);
    assert.equal(store.getItem(WELCOME_TOUR_REAL_VOTE_LOGGED_KEY), "1");
    assert.equal(store.getItem(WELCOME_TOUR_REAL_VOTE_PENDING_KEY), null);
    armTourRealVote(store);
    assert.equal(consumeTourRealVote(store), false);
  });
});

describe("welcome tour steps", () => {
  it("skips the guided vote when the feed has no head-to-head card", () => {
    assert.deepEqual(stepsForTour(false), ["categories", "predict", "rankings", "ready"]);
    assert.equal(shouldSkipPractice({ cardFound: true, waitedMs: 9_000, feedEmpty: true }), false);
    assert.equal(shouldSkipPractice({ cardFound: false, waitedMs: 0, feedEmpty: true }), true);
    assert.equal(
      shouldSkipPractice({ cardFound: false, waitedMs: PRACTICE_CARD_WAIT_MS - 1, feedEmpty: false }),
      false,
    );
    assert.equal(
      shouldSkipPractice({ cardFound: false, waitedMs: PRACTICE_CARD_WAIT_MS, feedEmpty: false }),
      true,
    );

    const seen: string[] = [];
    let phase: TourPhase = startRunning("link", false);
    while (phase.status === "running") {
      const step = currentTourStep(phase);
      assert.ok(step);
      seen.push(step);
      const next = advanceTour(phase);
      if (next.status === "done") break;
      phase = next;
    }
    assert.deepEqual(seen, ["categories", "predict", "rankings", "ready"]);
  });

  it("walks practice, then the quick tour, and keeps the chosen split", () => {
    const started = startRunning("preview", true);
    assert.equal(currentTourStep(started), "practice_tap");
    assert.equal(tourNextLabel("practice_tap"), null);
    assert.equal(tourNextLabel("categories"), "Next");
    assert.equal(tourNextLabel("ready"), "Done");

    const reveal = advanceTour({ ...started, side: "b", split: { a: 41, b: 59 } });
    assert.equal(reveal.status, "running");
    if (reveal.status !== "running") return;
    assert.equal(currentTourStep(reveal), "practice_reveal");
    assert.equal(reveal.side, "b");
    assert.deepEqual(reveal.split, { a: 41, b: 59 });
    assert.equal(tourStepCopy("your_turn", null).title, "Now it's your turn");
    assert.equal(tourStepCopy("ready", null).title, "You're set");
  });
});

describe("practice vote data", () => {
  it("uses only finite feed percents and explains a missing split without numbers", () => {
    assert.equal(readPracticeSplit(null, "10"), null);
    assert.equal(readPracticeSplit("", "10"), null);
    assert.equal(readPracticeSplit("nope", "40"), null);
    assert.equal(readPracticeSplit("10", undefined), null);
    assert.deepEqual(readPracticeSplit("62", "38"), { a: 62, b: 38 });
    assert.deepEqual(readPracticeSplit(" 0 ", "100"), { a: 0, b: 100 });
    assert.equal(practicePercentDataset(undefined, 10), null);
    assert.equal(practicePercentDataset(Number.NaN, 10), null);
    assert.deepEqual(practicePercentDataset(0, 100), {
      "data-option-a-percent": "0",
      "data-option-b-percent": "100",
    });
    assert.equal(formatLivePercent(62), "62");
    assert.equal(formatLivePercent(62.5), "62.5");
    assert.deepEqual(roundSplitTo100(62, 38), { a: 62, b: 38 });
    assert.deepEqual(roundSplitTo100(62.6, 37.4), { a: 63, b: 37 });
    assert.deepEqual(roundSplitTo100(33.3, 66.6), { a: 33, b: 67 });
    const thirds = roundSplitTo100(33.3, 66.6);
    assert.equal(thirds && thirds.a + thirds.b, 100);
    const missing = practiceRevealCopy(null);
    assert.equal(missing.includes("%"), false);
    assert.match(missing, /not saved/);
    assert.match(practiceRevealCopy({ a: 62, b: 38 }), /62% and 38%/);
  });

  it("never calls a vote API from the practice tap", () => {
    assert.match(tourUi, /logFunnelEvent\("tour_practice_vote", "vote"/);
    assert.match(tourUi, /readPracticeSplit\(/);
    assert.equal(tourUi.includes("trackVoteCast"), false);
    assert.equal(tourUi.includes("fetch("), false);
    assert.equal(tourUi.includes("/api/"), false);
    assert.equal(tourUi.includes("useAnonBudget"), false);
    assert.equal(tourUi.includes("handleMatchupVote"), false);
    assert.match(versus, /data-welcome-tour-h2h=""/);
    assert.match(versus, /practicePercentDataset\(matchup\.optionAPercent, matchup\.optionBPercent\)/);
    assert.match(funnel, /consumeTourRealVote\(localStorage\)/);
    assert.match(funnel, /logFunnelEvent\("tour_first_real_vote", "vote"\)/);
  });
});

describe("welcome tour entry points", () => {
  it("starts from the checklist in place, and from replay on the vote hub", () => {
    assert.match(checklist, /data-testid="vote-welcome-tour-slot"/);
    assert.match(checklist, /className="mt-3 h-32"/);
    assert.match(checklist, /requestWelcomeTour\("link"\)/);
    assert.match(preview, /requestWelcomeTour\("preview"\)/);
    assert.match(preview, /tour_preview_tapped/);
    assert.match(preview, /welcome-tour-preview-bar/);
    assert.equal(preview.includes("usePrefersReducedMotion"), false);
    assert.equal(preview.includes("fetch("), false);
    const css = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");
    assert.match(css, /@keyframes welcome-tour-preview-bar/);
    assert.match(css, /@keyframes welcome-tour-preview-finger/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(menu, /requestWelcomeTour\("replay"\)/);
    assert.match(menu, /button-show-me-how/);
    assert.equal(tourReplayDestination("/"), null);
    assert.equal(tourReplayDestination("/vote"), null);
    assert.equal(tourReplayDestination("/rankings"), "/vote");
    assert.equal(tourReplayDestination("/how-it-works"), "/vote");
  });

  it("queues one request for a later vote-page mount", () => {
    resetWelcomeTourBus();
    const store = memory();
    writeTourPending(store, "replay");
    assert.equal(readTourPending(store), "replay");
    assert.equal(store.getItem(WELCOME_TOUR_PENDING_KEY), "replay");
    clearTourPending(store);
    assert.equal(readTourPending(store), null);

    let heard = 0;
    const stop = subscribeTourRequest(() => {
      heard += 1;
    });
    requestWelcomeTour("link");
    assert.equal(heard, 1);
    assert.equal(takeTourRequest(), "link");
    assert.equal(takeTourRequest(), null);
    stop();
    resetWelcomeTourBus();
  });
});

describe("welcome tour chrome", () => {
  it("hides the pills and the anon nudge, and turns swipe trial drags off", () => {
    assert.match(host, /useWelcomeTourActive\(\)/);
    assert.match(host, /if \(tourActive\) return null/);
    assert.match(host, /useCornerPillIntro\("quick-vote", showFab\)/);
    assert.match(help, /useWelcomeTourActive\(\)/);
    assert.match(help, /if \(hidden \|\| tourActive\) return null/);
    assert.match(help, /useCornerPillIntro\("help-chat", !hidden\)/);
    assert.match(nudge, /useWelcomeTourActive\(\)/);
    assert.match(nudge, /placement === "hidden" \|\| tourActive/);
    assert.match(swipe, /gesturesEnabled && !tourActive && queue\.length >= 2/);
  });

  it("picks whichever Predict and Rankings control is actually visible", () => {
    assert.equal(
      pickVisibleId(PREDICT_NAV_TEST_IDS, (id) => id === "nav-predict"),
      "nav-predict",
    );
    assert.equal(
      pickVisibleId(RANKINGS_NAV_TEST_IDS, (id) => id === "nav-rankings-desktop"),
      "nav-rankings-desktop",
    );
    assert.equal(pickVisibleId(PREDICT_NAV_TEST_IDS, () => false), null);
  });

  it("keeps the bubble inside the safe area and locks scroll without fixing the body", () => {
    const phone = placeBubble({
      target: { top: 120, left: 16, width: 358, height: 420 },
      viewportWidth: 390,
      viewportHeight: 844,
      bubbleWidth: 304,
      bubbleHeight: 180,
      insets: { top: 47, right: 0, bottom: 34, left: 0 },
    });
    assert.ok(phone.top >= 47 + 8);
    assert.ok(phone.left >= 8);
    assert.ok(phone.left + phone.width <= 390 - 8);

    const nav = placeBubble({
      target: { top: 740, left: 80, width: 70, height: 56 },
      viewportWidth: 1280,
      viewportHeight: 800,
      bubbleWidth: 304,
      bubbleHeight: 170,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    assert.equal(nav.side, "top");
    assert.ok(nav.top + 170 <= 740);

    assert.equal(rectNeedsScroll({ top: 8, bottom: 300 }, 800, 47), true);
    assert.equal(rectNeedsScroll({ top: 200, bottom: 500 }, 800, 0), false);

    const listeners = new Map<string, EventListener>();
    const html = { style: { overflow: "", overscrollBehavior: "" }, clientWidth: 1000 };
    const body = {
      style: { overflow: "", paddingRight: "4px", touchAction: "", position: "" },
    };
    const doc = {
      documentElement: html,
      body,
      defaultView: { innerWidth: 1015 },
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string) {
        listeners.delete(type);
      },
    };
    const release = lockDocumentScroll(doc as unknown as Document);
    assert.equal(html.style.overflow, "");
    assert.equal(body.style.overflow, "");
    assert.equal(body.style.position, "");
    assert.equal(body.style.paddingRight, "4px");
    assert.equal(listeners.has("wheel"), true);
    assert.equal(listeners.has("touchmove"), true);
    assert.equal(listeners.has("keydown"), true);
    release();
    assert.equal(html.style.overflow, "");
    assert.equal(body.style.paddingRight, "4px");
    assert.equal(body.style.position, "");
    assert.equal(listeners.size, 0);
  });
});
