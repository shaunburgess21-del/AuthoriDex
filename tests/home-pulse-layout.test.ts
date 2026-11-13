import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HOME_PULSE_CARD_MAX_PX,
  IPHONE_18_PRO_WIDTH_PX,
  homePulseCardFits,
  homePulseCardWidth,
  homePulseContentWidth,
} from "../client/src/lib/homePulseLayout";

test("the Weekly Momentum card fits a 402pt phone", () => {
  assert.equal(homePulseContentWidth(IPHONE_18_PRO_WIDTH_PX), 386);
  assert.equal(homePulseCardWidth(IPHONE_18_PRO_WIDTH_PX), HOME_PULSE_CARD_MAX_PX);
  assert.equal(homePulseCardFits(IPHONE_18_PRO_WIDTH_PX), true);
  assert.equal(homePulseCardWidth(320), 304);
  assert.equal(homePulseCardFits(320), true);
  assert.equal(homePulseCardFits(16), false);
});

test("the home pulse row caps each card to the scrollport", () => {
  const home = readFileSync(new URL("../client/src/pages/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /Momentum \\u00B7 7d/);
  assert.match(
    home,
    /w-\[min\(100%,20rem\)\] max-w-full min-w-0 shrink-0 md:w-auto md:max-w-none/,
  );
  assert.match(home, /flex w-full min-w-0 max-w-full gap-4 overflow-x-auto/);
  assert.match(home, /container mx-auto min-w-0 max-w-7xl px-2/);
  assert.match(home, /shrink-0 px-2 py-0\.5 rounded text-xs font-mono/);
  assert.equal(home.includes("min-w-[280px]"), false);
});
