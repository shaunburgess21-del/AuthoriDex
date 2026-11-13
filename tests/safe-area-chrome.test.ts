import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ABOVE_TAB_BAR_BOTTOM,
  ABOVE_TAB_BAR_PADDING,
  PREDICTION_DOCK_CLASS,
} from "../client/src/lib/safeAreaChrome";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("fixed docks clear the tab bar and the home indicator", () => {
  assert.match(ABOVE_TAB_BAR_BOTTOM, /bottom-\[calc\(4rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(ABOVE_TAB_BAR_BOTTOM, /md:bottom-\[env\(safe-area-inset-bottom,0px\)\]/);
  assert.equal(ABOVE_TAB_BAR_BOTTOM.includes("md:bottom-0"), false);
  assert.match(ABOVE_TAB_BAR_PADDING, /pb-\[calc\(5rem\+env\(safe-area-inset-bottom,0px\)\)\]/);
  assert.match(ABOVE_TAB_BAR_PADDING, /md:pb-0/);
  assert.match(PREDICTION_DOCK_CLASS, /fixed /);
  assert.equal(PREDICTION_DOCK_CLASS.includes(ABOVE_TAB_BAR_BOTTOM), true);
});

test("prediction docks, the footer, and the leaderboard you-row use the shared clearance", () => {
  for (const file of [
    "client/src/pages/UpDownDetailPage.tsx",
    "client/src/pages/H2HDetailPage.tsx",
    "client/src/pages/CategoryRaceDetailPage.tsx",
  ]) {
    const source = read(file);
    assert.equal(source.includes("PREDICTION_DOCK_CLASS"), true, file);
    assert.equal(source.includes("md:bottom-0"), false, file);
  }
  assert.equal(read("client/src/components/Footer.tsx").includes("ABOVE_TAB_BAR_PADDING"), true);
  assert.equal(read("client/src/pages/UserLeaderboardPage.tsx").includes("ABOVE_TAB_BAR_BOTTOM"), true);
});

test("top toasts already clear the status bar and Dynamic Island", () => {
  const css = read("client/src/index.css");
  assert.match(
    css,
    /html \[data-sonner-toaster\]\[data-y-position="top"\]\s*\{[^}]*var\(--safe-area-inset-top, 0px\)/,
  );
});
