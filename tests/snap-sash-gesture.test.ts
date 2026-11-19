import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MOBILE_TAP_TARGET_PX } from "../client/src/lib/tapTarget";
import {
  SASH_DRAG_SLOP_PX,
  SASH_HANDLE_MIN_PX,
  applySashMove,
  releaseSash,
  rememberSashFullHeight,
  type SashSession,
} from "../client/src/lib/snapSashGesture";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function session(overrides: Partial<SashSession> = {}): SashSession {
  return {
    startY: 200,
    fullHeight: 400,
    startExpanded: false,
    moved: false,
    ...overrides,
  };
}

test("collapsed WebKit cards reuse the height measured while open", () => {
  assert.equal(rememberSashFullHeight(480, undefined, false), 480);
  assert.equal(rememberSashFullHeight(0, 480, true), 480);
  assert.equal(rememberSashFullHeight(20, 480, true), 480);
  assert.equal(rememberSashFullHeight(0, undefined, true), 0);
});

test("a press inside the slop is a tap, and a vertical drag resizes the card", () => {
  const open = session();
  const still = applySashMove(open, open.startY + SASH_DRAG_SLOP_PX);
  assert.equal(still.session.moved, false);
  assert.equal(still.height, null);
  assert.deepEqual(releaseSash(still.session, open.startY + SASH_DRAG_SLOP_PX), { type: "tap" });

  const up = applySashMove(open, open.startY - 100);
  assert.equal(up.session.moved, true);
  assert.equal(up.height, 300);
  assert.equal(up.opacity, 300 / 400);
  assert.deepEqual(releaseSash(up.session, open.startY - 100), { type: "settle", cardOpen: true });

  const collapse = applySashMove(open, open.startY - 250);
  assert.equal(collapse.height, 150);
  assert.deepEqual(releaseSash(collapse.session, open.startY - 250), { type: "settle", cardOpen: false });

  const expanded = session({ startExpanded: true });
  const reveal = applySashMove(expanded, expanded.startY + 250);
  assert.equal(reveal.height, 250);
  assert.deepEqual(releaseSash(reveal.session, expanded.startY + 250), { type: "settle", cardOpen: true });

  const short = applySashMove(expanded, expanded.startY + 100);
  assert.equal(short.height, 100);
  assert.deepEqual(releaseSash(short.session, expanded.startY + 100), { type: "settle", cardOpen: false });

  // Exactly halfway stays collapsed (the view used a strict greater-than).
  const mid = applySashMove(open, open.startY - 200);
  assert.equal(mid.height, 200);
  assert.deepEqual(releaseSash(mid.session, open.startY - 200), { type: "settle", cardOpen: false });
});

test("a drag with no measured card height does not snap", () => {
  const unknown = session({ fullHeight: 0 });
  const moved = applySashMove(unknown, unknown.startY + 40);
  assert.equal(moved.session.moved, true);
  assert.equal(moved.height, null);
  assert.deepEqual(releaseSash(moved.session, unknown.startY + 40), { type: "cancel" });
});

test("the sash handle is a 44px touch target and does not wait on a WKWebView click", () => {
  assert.equal(SASH_HANDLE_MIN_PX, MOBILE_TAP_TARGET_PX);

  const css = read("../client/src/index.css");
  const ruleStart = css.indexOf("button.sash-handle {");
  assert.ok(ruleStart > 0);
  const rule = css.slice(ruleStart, css.indexOf("@media (hover: hover) and (pointer: fine)", ruleStart));
  assert.match(rule, /min-height:\s*44px;/);
  assert.match(rule, /touch-action:\s*none;/);
  const fine = css.slice(css.indexOf("@media (hover: hover) and (pointer: fine)", ruleStart));
  assert.match(fine, /button\.sash-handle\s*\{[^}]*min-height:\s*0;/);
  assert.match(fine, /padding:\s*0 1\.5rem 0\.625rem;/);

  const view = read("../client/src/components/snap-scroll/VoteSnapScrollView.tsx");
  const handleAt = view.indexOf('data-sash-handle=""');
  assert.ok(handleAt > 0);
  const handle = view.slice(handleAt - 400, handleAt + 1600);
  assert.match(handle, /<button/);
  assert.match(handle, /type="button"/);
  assert.match(handle, /className="sash-handle/);
  assert.match(handle, /touchAction:\s*"none"/);
  assert.match(handle, /onClick=\{\(\) => handleHandleClick\(item\.id, isExpanded\)\}/);
  assert.match(handle, /e\.pointerType === "mouse"/);
  assert.equal(handle.includes("setPointerCapture"), false);
  assert.equal(handle.includes("onTouchMove"), false);

  assert.match(view, /window\.addEventListener\("touchmove", onSashTouchMove, \{ capture: true, passive: false \}\)/);
  assert.equal(view.includes('addEventListener("touchstart", onSashTouchStart'), false);
  assert.match(view, /releaseSash\(drag, clientY\)/);
  assert.match(view, /setExpandedItemId\(drag\.startExpanded \? null : drag\.itemId\)/);
  assert.equal(view.includes("the click handler performs the toggle"), false);
});
