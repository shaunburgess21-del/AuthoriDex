import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DISCUSSION_SHELL_OPEN_ATTR,
  discussionPinStillCurrent,
  discussionPlaceholderName,
  discussionShellViewportBox,
  isDiscussionShellOpen,
  nextDiscussionPinGeneration,
  pointInsideRect,
  shouldRecoverDiscussionPointer,
} from "../client/src/lib/discussionShell";

describe("discussionPlaceholderName", () => {
  it("uses the given name for a first name and surname", () => {
    assert.equal(discussionPlaceholderName("Sabrina Carpenter"), "Sabrina");
    assert.equal(discussionPlaceholderName("  Kim   Kardashian "), "Kim");
  });

  it("keeps a single-word name", () => {
    assert.equal(discussionPlaceholderName("Cher"), "Cher");
    assert.equal(discussionPlaceholderName("Blackpink"), "Blackpink");
  });

  it("keeps title-led and non-person names whole", () => {
    assert.equal(discussionPlaceholderName("The Weeknd"), "The Weeknd");
    assert.equal(discussionPlaceholderName("The Beatles"), "The Beatles");
    assert.equal(discussionPlaceholderName("DJ Khaled"), "DJ Khaled");
    assert.equal(discussionPlaceholderName("50 Cent"), "50 Cent");
    assert.equal(discussionPlaceholderName("Red Hot Chili Peppers"), "Red Hot Chili Peppers");
  });

  it("uses the given name when the middle token is an initial", () => {
    assert.equal(discussionPlaceholderName("Mary J. Blige"), "Mary");
    assert.equal(discussionPlaceholderName("Mary J Blige"), "Mary");
  });
});

describe("discussionShellViewportBox", () => {
  it("ignores a small URL-bar delta", () => {
    assert.equal(
      discussionShellViewportBox({ innerHeight: 800, visualHeight: 760, offsetTop: 20 }),
      null,
    );
  });

  it("lifts the shell above the keyboard", () => {
    assert.deepEqual(
      discussionShellViewportBox({ innerHeight: 800, visualHeight: 430, offsetTop: 0 }),
      { top: 0, bottom: 370 },
    );
  });

  it("follows a large visual-viewport pan", () => {
    assert.deepEqual(
      discussionShellViewportBox({ innerHeight: 800, visualHeight: 500, offsetTop: 180 }),
      { top: 180, bottom: 120 },
    );
  });
});

describe("shouldRecoverDiscussionPointer", () => {
  const shellRect = { left: 0, top: 0, right: 390, bottom: 844 };

  it("catches a tap that landed on the page behind the shell", () => {
    assert.equal(
      shouldRecoverDiscussionPointer({
        targetInsideShell: false,
        targetAboveShell: false,
        clientX: 180,
        clientY: 780,
        shellRect,
      }),
      true,
    );
  });

  it("leaves a tap that already hit the field alone", () => {
    assert.equal(
      shouldRecoverDiscussionPointer({
        targetInsideShell: true,
        targetAboveShell: false,
        clientX: 180,
        clientY: 780,
        shellRect,
      }),
      false,
    );
  });

  it("leaves the comment action sheet and other dialogs alone", () => {
    assert.equal(
      shouldRecoverDiscussionPointer({
        targetInsideShell: false,
        targetAboveShell: true,
        clientX: 180,
        clientY: 780,
        shellRect,
      }),
      false,
    );
  });

  it("ignores a tap outside the shell box", () => {
    assert.equal(
      shouldRecoverDiscussionPointer({
        targetInsideShell: false,
        targetAboveShell: false,
        clientX: 10,
        clientY: 900,
        shellRect,
      }),
      false,
    );
  });

  it("matches the field with a little slop for the safe-area padding", () => {
    const field = { left: 48, top: 760, right: 370, bottom: 800 };
    assert.equal(pointInsideRect(60, 812, field, 16), true);
    assert.equal(pointInsideRect(60, 700, field, 16), false);
  });
});

describe("isDiscussionShellOpen", () => {
  it("reads the document flag the feed uses to ignore keyboard scroll", () => {
    const attrs = new Set<string>();
    const root = {
      documentElement: {
        hasAttribute: (name: string) => attrs.has(name),
      },
    };
    assert.equal(isDiscussionShellOpen(root), false);
    attrs.add(DISCUSSION_SHELL_OPEN_ATTR);
    assert.equal(isDiscussionShellOpen(root), true);
    assert.equal(isDiscussionShellOpen(null), false);
  });

  it("invalidates a closed shell's scroll restore when another shell opens", () => {
    const first = nextDiscussionPinGeneration();
    assert.equal(discussionPinStillCurrent(first), true);
    const second = nextDiscussionPinGeneration();
    assert.equal(discussionPinStillCurrent(first), false);
    assert.equal(discussionPinStillCurrent(second), true);
  });
});
