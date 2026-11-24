import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SNAP_SHELL_HEIGHT,
  endSnapOffsetReachable,
  fullSnapPageBox,
  snapShellFrame,
} from "../client/src/lib/snapPageLayout";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const view = readFileSync(
  join(root, "client/src/components/snap-scroll/VoteSnapScrollView.tsx"),
  "utf8",
);

describe("end snap reachability", () => {
  it("cannot reach an end section shorter than the scrollport", () => {
    // iOS Safari: layout viewport extends ~120px under the toolbar, header is
    // ~48px, pages were calc(100dvh - 52px). The end snap sits past max-scroll.
    const dvh = 770;
    const layout = dvh + 120;
    const header = 48;
    const page = dvh - 52;
    const scrollport = layout - header;
    assert.equal(
      endSnapOffsetReachable({
        cardCount: 4,
        cardHeight: page,
        endHeight: page,
        scrollport,
      }),
      false,
    );
  });

  it("reaches the end section when every page matches the scrollport", () => {
    const scrollport = 640;
    assert.equal(
      endSnapOffsetReachable({
        cardCount: 4,
        cardHeight: scrollport,
        endHeight: scrollport,
        scrollport,
      }),
      true,
    );
  });

  it("still reaches the end section when 100% rounds a fraction short", () => {
    const scrollport = 640;
    const short = scrollport - 0.8;
    assert.equal(
      endSnapOffsetReachable({
        cardCount: 6,
        cardHeight: short,
        endHeight: short,
        scrollport,
      }),
      false,
    );
    assert.equal(
      endSnapOffsetReachable({
        cardCount: 6,
        cardHeight: short,
        endHeight: short,
        scrollport,
        trailing: 1,
      }),
      true,
    );
  });
});

describe("fullSnapPageBox", () => {
  it("sizes cards and the end section to the scrollport", () => {
    const card = fullSnapPageBox("card");
    const end = fullSnapPageBox("end");
    for (const box of [card, end]) {
      assert.equal(box.height, "100%");
      assert.equal(box.minHeight, "100%");
      assert.equal(box.maxHeight, "100%");
      assert.equal(box.boxSizing, "border-box");
      assert.equal(box.scrollSnapAlign, "start");
      assert.equal(box.overflow, "hidden");
    }
    assert.equal(card.scrollSnapStop, undefined);
    assert.equal(end.scrollSnapStop, "always");
    assert.match(card.paddingBottom ?? "", /safe-area-inset-bottom/);
    assert.equal(end.paddingBottom, undefined);
  });
});

describe("snapShellFrame", () => {
  it("leaves a shell that already matches the layout viewport on 100dvh", () => {
    assert.equal(SNAP_SHELL_HEIGHT, "100dvh");
    assert.equal(
      snapShellFrame({ innerHeight: 800, visualHeight: 800, offsetTop: 0 }),
      null,
    );
  });

  it("pulls the shell up off a Safari toolbar that the layout viewport still covers", () => {
    assert.deepEqual(
      snapShellFrame({ innerHeight: 844, visualHeight: 730, offsetTop: 0 }),
      { top: 0, height: 730 },
    );
  });

  it("starts below a URL bar that overlaps the layout viewport", () => {
    assert.deepEqual(
      snapShellFrame({ innerHeight: 900, visualHeight: 760, offsetTop: 48 }),
      { top: 48, height: 760 },
    );
  });

  it("does not chase the keyboard", () => {
    assert.equal(
      snapShellFrame({ innerHeight: 844, visualHeight: 420, offsetTop: 0 }),
      null,
    );
    assert.equal(
      snapShellFrame({ innerHeight: 844, visualHeight: 500, offsetTop: 280 }),
      null,
    );
  });
});

describe("VoteSnapScrollView wiring", () => {
  it("does not size snap pages with the viewport-minus-52px guess", () => {
    assert.equal(view.includes("calc(100dvh - 52px)"), false);
    assert.equal(view.includes("fullSnapPageBox"), true);
    assert.equal(view.includes("snapShellFrame"), true);
    assert.equal(view.includes("createPortal"), true);
    assert.match(view, /data-testid="snap-end-card"/);
  });
});
