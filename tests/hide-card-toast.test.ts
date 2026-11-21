import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { TOAST_DURATION_MS } from "../client/src/lib/toast-policy";
import {
  HIDE_CARD_TOAST_DURATION_MS,
  attachHoldPause,
  createDismissCountdown,
  holdPauseReducer,
  initialHoldPauseState,
  isHoldPaused,
  type HoldPauseEvent,
  type HoldPauseState,
} from "../client/src/lib/hide-card-toast-pause";

const root = path.resolve(import.meta.dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

class Emitter {
  private listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function pointerEvent(type: string, pointerType: string): Event {
  const event = new Event(type);
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

function apply(state: HoldPauseState, event: HoldPauseEvent): HoldPauseState {
  return holdPauseReducer(state, event);
}

test("card hidden toast waits 6s and does not change the global toast duration", () => {
  assert.equal(HIDE_CARD_TOAST_DURATION_MS, 6_000);
  assert.equal(TOAST_DURATION_MS, 3_000);

  const hook = read("client/src/hooks/useHideCard.ts");
  const toastSource = read("client/src/lib/hide-card-toast.ts");
  assert.match(hook, /showCardHiddenToast\(/);
  assert.equal(hook.includes('toast("Card hidden"'), false);
  assert.match(toastSource, /duration:\s*Number\.POSITIVE_INFINITY/);
  assert.match(toastSource, /HIDE_CARD_TOAST_DURATION_MS/);
  assert.match(toastSource, /label:\s*"Undo"/);

  const restored = hook.match(/toast\("Card restored"\)/g) ?? [];
  assert.equal(restored.length, 2);
  assert.equal(hook.includes("Card restored"), true);
  assert.equal(/toast\("Card restored"[\s\S]{0,80}duration/.test(hook), false);
});

test("undo is at least 44px tall on mobile and only on the card-hidden toast", () => {
  const css = read("client/src/index.css");
  const at = css.indexOf('data-testid="toast-card-hidden"');
  const rule = css.slice(Math.max(0, at - 180), at + 280);
  assert.ok(at > 0);
  assert.match(rule, /max-width:\s*767px/);
  assert.match(rule, /height:\s*44px/);
  assert.match(rule, /min-height:\s*44px/);
  assert.match(rule, /hide-card-undo/);
  assert.match(read("client/src/lib/hide-card-toast.ts"), /actionButton:\s*"hide-card-undo"/);
});

test("a mouse hover pauses and leaving resumes", () => {
  let state = initialHoldPauseState();
  assert.equal(isHoldPaused(state), false);
  state = apply(state, { type: "pointerenter", pointerType: "mouse" });
  assert.equal(isHoldPaused(state), true);
  state = apply(state, { type: "pointerdown" });
  state = apply(state, { type: "pointerup" });
  assert.equal(isHoldPaused(state), true);
  state = apply(state, { type: "pointerleave", pointerType: "mouse" });
  assert.equal(isHoldPaused(state), false);
});

test("a touch pointerenter does not count as hover, and release resumes", () => {
  let state = initialHoldPauseState();
  state = apply(state, { type: "pointerenter", pointerType: "touch" });
  assert.equal(isHoldPaused(state), false);
  state = apply(state, { type: "touchstart" });
  state = apply(state, { type: "pointerdown" });
  assert.equal(isHoldPaused(state), true);
  state = apply(state, { type: "pointerup" });
  assert.equal(isHoldPaused(state), true);
  state = apply(state, { type: "touchend" });
  assert.equal(isHoldPaused(state), false);
  state = apply(state, { type: "pointerleave", pointerType: "touch" });
  assert.equal(isHoldPaused(state), false);
});

test("pointer cancel and touch cancel release the hold", () => {
  let pressed = apply(initialHoldPauseState(), { type: "pointerdown" });
  pressed = apply(pressed, { type: "pointercancel" });
  assert.equal(isHoldPaused(pressed), false);

  let touched = apply(initialHoldPauseState(), { type: "touchstart" });
  touched = apply(touched, { type: "touchcancel" });
  assert.equal(isHoldPaused(touched), false);
});

test("listeners pause on hover or touch and resume on leave or release", () => {
  const el = new Emitter();
  const paused: boolean[] = [];
  const detach = attachHoldPause(el, (next) => paused.push(next));

  el.emit("pointerenter", pointerEvent("pointerenter", "mouse"));
  assert.deepEqual(paused, [true]);
  el.emit("pointerleave", pointerEvent("pointerleave", "mouse"));
  assert.deepEqual(paused, [true, false]);

  el.emit("pointerenter", pointerEvent("pointerenter", "touch"));
  assert.deepEqual(paused, [true, false]);

  el.emit("touchstart");
  el.emit("pointerdown");
  assert.deepEqual(paused, [true, false, true]);
  el.emit("pointerup");
  el.emit("touchend");
  assert.deepEqual(paused, [true, false, true, false]);

  detach();
  el.emit("pointerenter", pointerEvent("pointerenter", "mouse"));
  el.emit("touchstart");
  assert.deepEqual(paused, [true, false, true, false]);
});

test("the countdown fires after 6s and a hold keeps the remaining time", () => {
  let now = 1_000;
  const queued: Array<{ fn: () => void; at: number }> = [];
  let fired = 0;
  const countdown = createDismissCountdown({
    durationMs: HIDE_CARD_TOAST_DURATION_MS,
    now: () => now,
    schedule: (fn, ms) => {
      queued.push({ fn, at: now + ms });
      return queued.length;
    },
    onFire: () => {
      fired += 1;
    },
  });

  assert.equal(queued[0]?.at, 1_000 + 6_000);
  now = 3_000;
  countdown.setPaused(true);
  queued[0]?.fn();
  assert.equal(fired, 0);

  now = 20_000;
  countdown.setPaused(false);
  assert.equal(fired, 0);
  const resumed = queued[queued.length - 1];
  assert.equal(resumed?.at, 20_000 + 4_000);

  now = 24_000;
  resumed?.fn();
  assert.equal(fired, 1);
  resumed?.fn();
  assert.equal(fired, 1);
});

test("releasing after the countdown has already elapsed dismisses immediately", () => {
  let now = 0;
  const queued: Array<{ fn: () => void }> = [];
  let fired = 0;
  const countdown = createDismissCountdown({
    durationMs: 6_000,
    now: () => now,
    schedule: (fn) => {
      queued.push({ fn });
      return queued.length;
    },
    onFire: () => {
      fired += 1;
    },
  });
  now = 6_500;
  countdown.setPaused(true);
  now = 9_000;
  countdown.setPaused(false);
  assert.equal(fired, 1);
  assert.equal(queued.length, 1);
});

test("cancel stops a paused countdown from firing", () => {
  let fired = 0;
  const queued: Array<() => void> = [];
  const countdown = createDismissCountdown({
    durationMs: 6_000,
    now: () => 0,
    schedule: (fn) => {
      queued.push(fn);
      return queued.length;
    },
    onFire: () => {
      fired += 1;
    },
  });
  countdown.setPaused(true);
  countdown.cancel();
  countdown.setPaused(false);
  queued.forEach((fn) => fn());
  assert.equal(fired, 0);
});
