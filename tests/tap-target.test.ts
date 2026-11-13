import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MOBILE_TAP_TARGET_PX, expandedHitBox } from "../client/src/lib/tapTarget";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("a compact control grows to 44px without shrinking a larger one", () => {
  assert.equal(MOBILE_TAP_TARGET_PX, 44);
  assert.deepEqual(expandedHitBox({ width: 16, height: 16 }), { width: 44, height: 44 });
  assert.deepEqual(expandedHitBox({ width: 32, height: 32 }), { width: 44, height: 44 });
  assert.deepEqual(expandedHitBox({ width: 120, height: 28 }), { width: 120, height: 44 });
  assert.deepEqual(expandedHitBox({ width: 48, height: 48 }), { width: 48, height: 48 });
});

test("the hit area is mobile-only and does not paint a new background", () => {
  const css = read("../client/src/index.css");
  const start = css.indexOf("/* 44px hit area on compact mobile controls.");
  assert.ok(start > 0);
  const block = css.slice(start);
  assert.match(block, /@media \(max-width: 767px\)/);
  assert.match(block, /\.tap-44:not\(\.absolute\)[\s\S]*position: relative;/);
  assert.match(block, /\.tap-44::before[\s\S]*width: max\(100%, 44px\);/);
  assert.match(block, /\.tap-44::before[\s\S]*height: max\(100%, 44px\);/);
  const rule = block.slice(block.indexOf(".tap-44::before"), block.indexOf(".tap-44::before") + 280);
  assert.equal(rule.includes("background"), false);
});

test("icon buttons, chips, close controls, and vote chips opt into the hit area", () => {
  const files = [
    "../client/src/components/ui/button.tsx",
    "../client/src/components/ui/dialog.tsx",
    "../client/src/components/ui/sheet.tsx",
    "../client/src/components/ui/password-input.tsx",
    "../client/src/components/comments/CommentSortHeader.tsx",
    "../client/src/components/insights/InsightsHeader.tsx",
    "../client/src/components/quick-vote/QuickVoteHost.tsx",
    "../client/src/components/StreakToast.tsx",
    "../client/src/components/snap-scroll/CategoryTabStrip.tsx",
    "../client/src/components/snap-scroll/VoteSnapScrollView.tsx",
  ];
  for (const file of files) {
    assert.match(read(file), /tap-44/, file);
  }
  const button = read("../client/src/components/ui/button.tsx");
  assert.match(button, /sm: "min-h-8 rounded-md px-3 text-xs tap-44"/);
  assert.match(button, /icon: "h-9 w-9 tap-44"/);
  assert.equal(button.includes('default: "min-h-9 px-4 py-2 tap-44"'), false);
});
