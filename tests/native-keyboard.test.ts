import test from "node:test";
import assert from "node:assert/strict";

import {
  KEYBOARD_OBSCURE_THRESHOLD_PX,
  fieldNeedsScroll,
  isTextEntryControl,
  pointerChainKeepsKeyboard,
  pointerNodeKeepsKeyboard,
  reduceKeyboardViewport,
  shouldBlurTextEntryOnPathChange,
  shouldConsumeBackForKeyboard,
  shouldDismissKeyboardOnPointer,
  snapTypeBlocksVerticalScroll,
} from "../client/src/lib/nativeKeyboard";

const CLOSED = 800;

test("keyboard stays closed when the viewport has not shrunk", () => {
  const next = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    { innerHeight: CLOSED, visualHeight: CLOSED, textEntryFocused: true },
  );
  assert.equal(next.open, false);
  assert.equal(next.overlapPx, 0);
  assert.equal(next.closedInnerHeight, CLOSED);
});

test("a focused field plus a layout shrink marks the keyboard open and freezes the baseline", () => {
  const next = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    { innerHeight: 470, visualHeight: 470, textEntryFocused: true },
  );
  assert.equal(next.open, true);
  assert.equal(next.overlapPx, 330);
  assert.equal(next.closedInnerHeight, CLOSED);
});

test("visual-viewport shrink counts when the layout viewport does not", () => {
  const next = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    { innerHeight: CLOSED, visualHeight: CLOSED - 320, textEntryFocused: true },
  );
  assert.equal(next.open, true);
  assert.equal(next.overlapPx, 320);
  assert.equal(next.closedInnerHeight, CLOSED);
});

test("a large drop without a focused field does not latch the keyboard or the shrunk height", () => {
  const next = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    { innerHeight: 400, visualHeight: 400, textEntryFocused: false },
  );
  assert.equal(next.open, false);
  assert.equal(next.overlapPx, 400);
  assert.equal(next.closedInnerHeight, CLOSED);
});

test("a sub-keyboard inset tweak does not open the keyboard", () => {
  const next = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    {
      innerHeight: CLOSED - KEYBOARD_OBSCURE_THRESHOLD_PX,
      visualHeight: CLOSED - KEYBOARD_OBSCURE_THRESHOLD_PX,
      textEntryFocused: true,
    },
  );
  assert.equal(next.open, false);
  assert.equal(next.closedInnerHeight, CLOSED - KEYBOARD_OBSCURE_THRESHOLD_PX);
});

test("closing the keyboard adopts the restored height as the new baseline", () => {
  const open = reduceKeyboardViewport(
    { closedInnerHeight: CLOSED },
    { innerHeight: 480, visualHeight: 480, textEntryFocused: true },
  );
  const closed = reduceKeyboardViewport(open, {
    innerHeight: CLOSED,
    visualHeight: CLOSED,
    textEntryFocused: false,
  });
  assert.equal(closed.open, false);
  assert.equal(closed.closedInnerHeight, CLOSED);
});

test("text entry is email, password, number, search, and textarea — not buttons or hidden fields", () => {
  assert.equal(isTextEntryControl({ tag: "input", type: "email" }), true);
  assert.equal(isTextEntryControl({ tag: "input", type: "password" }), true);
  assert.equal(isTextEntryControl({ tag: "input", type: "number" }), true);
  assert.equal(isTextEntryControl({ tag: "input", type: "search" }), true);
  assert.equal(isTextEntryControl({ tag: "textarea" }), true);
  assert.equal(isTextEntryControl({ tag: "div", contentEditable: true }), true);
  assert.equal(isTextEntryControl({ tag: "input", type: "hidden" }), false);
  assert.equal(isTextEntryControl({ tag: "input", type: "checkbox" }), false);
  assert.equal(isTextEntryControl({ tag: "input", type: "button" }), false);
  assert.equal(isTextEntryControl({ tag: "input", type: "email", readOnly: true }), false);
  assert.equal(isTextEntryControl({ tag: "textarea", disabled: true }), false);
  assert.equal(isTextEntryControl({ tag: "select" }), false);
  assert.equal(isTextEntryControl({ tag: "button" }), false);
});

test("the first Back press is consumed only while a text field is focused", () => {
  assert.equal(shouldConsumeBackForKeyboard(true), true);
  assert.equal(shouldConsumeBackForKeyboard(false), false);
});

test("pathname changes blur a focused field; query updates on the same path do not", () => {
  assert.equal(shouldBlurTextEntryOnPathChange("/vote", "/person/abc", true), true);
  assert.equal(shouldBlurTextEntryOnPathChange("/vote", "/vote", true), false);
  assert.equal(shouldBlurTextEntryOnPathChange("/login", "/login/welcome", false), false);
});

test("empty-space taps dismiss; buttons, links, and other fields do not", () => {
  assert.equal(
    shouldDismissKeyboardOnPointer({ textEntryFocused: true, targetKeepsFocus: false }),
    true,
  );
  assert.equal(
    shouldDismissKeyboardOnPointer({ textEntryFocused: true, targetKeepsFocus: true }),
    false,
  );
  assert.equal(
    shouldDismissKeyboardOnPointer({ textEntryFocused: false, targetKeepsFocus: false }),
    false,
  );
});

test("a tap on a field, contenteditable, or labeled control does not dismiss", () => {
  assert.equal(pointerNodeKeepsKeyboard({ tag: "textarea" }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "input", type: "email" }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "input", type: "search" }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "div", contentEditable: true }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "div", keepKeyboard: true }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "label" }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "button" }), true);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "div" }), false);
  assert.equal(pointerNodeKeepsKeyboard({ tag: "p" }), false);

  assert.equal(
    pointerChainKeepsKeyboard([{ tag: "span" }, { tag: "label" }]),
    true,
  );
  assert.equal(
    pointerChainKeepsKeyboard([{ tag: "div" }, { tag: "textarea" }]),
    true,
  );
  assert.equal(
    pointerChainKeepsKeyboard([
      { tag: "span" },
      { tag: "div", contentEditable: true },
    ]),
    true,
  );
  assert.equal(
    pointerChainKeepsKeyboard([{ tag: "span" }, { tag: "div", keepKeyboard: true }]),
    true,
  );
  assert.equal(
    pointerChainKeepsKeyboard([{ tag: "span" }, { tag: "section" }]),
    false,
  );
  assert.equal(
    shouldDismissKeyboardOnPointer({
      textEntryFocused: true,
      targetKeepsFocus: pointerChainKeepsKeyboard([{ tag: "textarea" }]),
    }),
    false,
  );
  assert.equal(
    shouldDismissKeyboardOnPointer({
      textEntryFocused: true,
      targetKeepsFocus: pointerChainKeepsKeyboard([{ tag: "div" }, { tag: "main" }]),
    }),
    true,
  );
});

test("a visible field is not scrolled just because it sits near the viewport edge", () => {
  assert.equal(
    fieldNeedsScroll({ top: 120, bottom: 160 }, { top: 0, bottom: 500 }),
    false,
  );
  // Bottom-pinned comment composer, fully on screen. Scrolling this
  // during focus is what hid the Android soft keyboard.
  assert.equal(
    fieldNeedsScroll({ top: 740, bottom: 798 }, { top: 0, bottom: 800 }),
    false,
  );
  assert.equal(
    fieldNeedsScroll({ top: 4, bottom: 48 }, { top: 0, bottom: 500 }),
    false,
  );
  // Full-height expanded composer still shows a usable top edge.
  assert.equal(
    fieldNeedsScroll({ top: 72, bottom: 760 }, { top: 0, bottom: 500 }),
    false,
  );
});

test("a field actually covered by the keyboard still scrolls into view", () => {
  assert.equal(
    fieldNeedsScroll({ top: 640, bottom: 690 }, { top: 0, bottom: 500 }),
    true,
  );
  assert.equal(
    fieldNeedsScroll({ top: 470, bottom: 510 }, { top: 0, bottom: 500 }),
    true,
  );
});

test("vertical snap containers block scroll-into-view; horizontal chip rows do not", () => {
  assert.equal(snapTypeBlocksVerticalScroll("y mandatory"), true);
  assert.equal(snapTypeBlocksVerticalScroll("block proximity"), true);
  assert.equal(snapTypeBlocksVerticalScroll("both mandatory"), true);
  assert.equal(snapTypeBlocksVerticalScroll("x mandatory"), false);
  assert.equal(snapTypeBlocksVerticalScroll("none"), false);
  assert.equal(snapTypeBlocksVerticalScroll(""), false);
});
