import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CORNER_INTRO_MIN_JOIN_MS,
  CORNER_INTRO_MS,
  CORNER_INTRO_SETTLE_CAP_MS,
  CORNER_INTRO_SETTLE_MS,
  createCornerIntroCoordinator,
} from "../client/src/lib/cornerPillIntro";

type Saved = { introduced: string[]; endsAt: number } | null;

function fakeClock(initial: Saved = null, startAt = 1_000) {
  let now = startAt;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let saved: Saved = initial;

  const coordinator = createCornerIntroCoordinator({
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    load: () => saved,
    save: (state) => {
      saved = state;
    },
  });

  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = target;
  };

  return { coordinator, advance, saved: () => saved };
}

describe("corner pill intro", () => {
  it("expands pills that mount together at the same moment and collapses them together", () => {
    const { coordinator, advance } = fakeClock();
    coordinator.register("help-chat");
    advance(100);
    coordinator.register("quick-vote");
    assert.equal(coordinator.isShowing(), false, "waits for the page to settle");

    advance(CORNER_INTRO_SETTLE_MS);
    assert.equal(coordinator.isShowing(), true);

    advance(CORNER_INTRO_MS - 1);
    assert.equal(coordinator.isShowing(), true);
    advance(1);
    assert.equal(coordinator.isShowing(), false);
  });

  it("starts by the settle cap even if pills keep arriving", () => {
    const { coordinator, advance } = fakeClock();
    coordinator.register("help-chat");
    for (let elapsed = 0; elapsed < CORNER_INTRO_SETTLE_CAP_MS; elapsed += 300) {
      advance(300);
      coordinator.register(`pill-${elapsed}`);
    }
    assert.equal(coordinator.isShowing(), true);
  });

  it("does not replay for pills that already introduced themselves", () => {
    const { coordinator, advance } = fakeClock();
    const offHelp = coordinator.register("help-chat");
    advance(CORNER_INTRO_SETTLE_MS + CORNER_INTRO_MS);
    offHelp();

    coordinator.register("help-chat");
    advance(CORNER_INTRO_SETTLE_CAP_MS);
    assert.equal(coordinator.isShowing(), false);
  });

  it("replays for every pill on screen when a new pill needs its intro", () => {
    const { coordinator, advance } = fakeClock();
    coordinator.register("help-chat");
    advance(CORNER_INTRO_SETTLE_MS + CORNER_INTRO_MS);
    assert.equal(coordinator.isShowing(), false);

    coordinator.register("vote-eye");
    advance(CORNER_INTRO_SETTLE_MS);
    assert.equal(coordinator.isShowing(), true, "the help pill shares this intro too");
  });

  it("keeps everyone open long enough for a pill that arrives mid-intro", () => {
    const { coordinator, advance } = fakeClock();
    coordinator.register("help-chat");
    advance(CORNER_INTRO_SETTLE_MS + CORNER_INTRO_MS - 200);
    coordinator.register("quick-vote");
    advance(CORNER_INTRO_MIN_JOIN_MS - 1);
    assert.equal(coordinator.isShowing(), true);
    advance(1);
    assert.equal(coordinator.isShowing(), false);
  });

  it("does not count a pill that leaves before the intro starts", () => {
    const { coordinator, advance, saved } = fakeClock();
    const off = coordinator.register("vote-eye");
    advance(CORNER_INTRO_SETTLE_MS / 2);
    off();
    advance(CORNER_INTRO_SETTLE_CAP_MS);
    assert.equal(coordinator.isShowing(), false);
    assert.equal(saved(), null);
  });

  it("registers Quick Vote with the same intro as chat and the eye, with no opened-once gate", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const host = read("../client/src/components/quick-vote/QuickVoteHost.tsx");
    const help = read("../client/src/components/help-chat/HelpChat.tsx");
    const eye = read("../client/src/components/VoteActivityFilterFab.tsx");

    assert.match(host, /useCornerPillIntro\("quick-vote", showFab\)/);
    assert.equal(host.includes("hasOpenedQuickVote"), false);
    assert.equal(host.includes("voxdex_quick_vote_opened"), false);
    assert.equal(host.includes("voxdex_quick_vote_pill_reminder"), false);
    assert.match(help, /useCornerPillIntro\("help-chat", !hidden\)/);
    assert.match(eye, /useCornerPillIntro\(scope === "predict" \? "predict-eye" : "vote-eye", true\)/);
  });

  it("finishes an intro already in progress after a reload instead of restarting it", () => {
    const { coordinator, advance } = fakeClock({ introduced: ["help-chat"], endsAt: 2_000 }, 1_000);
    assert.equal(coordinator.isShowing(), true);
    coordinator.register("help-chat");
    advance(999);
    assert.equal(coordinator.isShowing(), true);
    advance(1);
    assert.equal(coordinator.isShowing(), false);
  });
});
