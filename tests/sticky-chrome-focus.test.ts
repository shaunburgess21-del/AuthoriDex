import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { shouldMoveFocusIntoOverlay } from "../client/src/lib/stickyChromeFocus";

describe("shouldMoveFocusIntoOverlay", () => {
  it("moves focus out of the sticky chip bar even when autofocus was cancelled", () => {
    assert.equal(
      shouldMoveFocusIntoOverlay({
        insideOverlay: false,
        inStickyChrome: true,
        displacedToTop: false,
        defaultPrevented: true,
      }),
      true,
    );
  });

  it("leaves focus that a drawer already placed inside itself", () => {
    assert.equal(
      shouldMoveFocusIntoOverlay({
        insideOverlay: true,
        inStickyChrome: false,
        displacedToTop: false,
        defaultPrevented: true,
      }),
      false,
    );
  });

  it("homes focus that inert just pushed to the document body", () => {
    assert.equal(
      shouldMoveFocusIntoOverlay({
        insideOverlay: false,
        inStickyChrome: false,
        displacedToTop: true,
        defaultPrevented: false,
      }),
      true,
    );
  });

  it("does not override a caller that opted out while focus sits on the page", () => {
    assert.equal(
      shouldMoveFocusIntoOverlay({
        insideOverlay: false,
        inStickyChrome: false,
        displacedToTop: true,
        defaultPrevented: true,
      }),
      false,
    );
  });
});

describe("sticky chrome focus wiring", () => {
  const drawer = readFileSync(new URL("../client/src/components/ui/drawer.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../client/src/components/ui/dialog.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../client/src/components/ui/sheet.tsx", import.meta.url), "utf8");
  const vote = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../client/src/App.tsx", import.meta.url), "utf8");

  it("runs for shared drawers, dialogs, and sheets, and for the vote suggest drawers", () => {
    for (const source of [drawer, dialog, sheet]) {
      assert.match(source, /releaseStickyChromeOnOpen\(event\)/);
      assert.match(source, /releaseStickyChromeOnClose\(\)/);
    }
    assert.match(vote, /data-sticky-chrome=""/);
    assert.match(vote, /onOpenAutoFocus=\{releaseStickyChromeOnOpen\}/);
    assert.match(app, /StickyChromeFocusGuard/);
  });
});
