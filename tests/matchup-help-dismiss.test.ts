import test from "node:test";
import assert from "node:assert/strict";

import { isMatchupHelpDismissed } from "../client/src/lib/matchup-help-dismiss";

test("isMatchupHelpDismissed: hidden when localStorage flag set", () => {
  assert.equal(
    isMatchupHelpDismissed({
      profileDismissedAt: null,
      localDismissed: true,
      isLoggedIn: false,
      profileLoaded: false,
    }),
    true,
  );
});

test("isMatchupHelpDismissed: hidden for signed-in user with profile timestamp", () => {
  assert.equal(
    isMatchupHelpDismissed({
      profileDismissedAt: "2026-05-24T12:00:00.000Z",
      localDismissed: false,
      isLoggedIn: true,
      profileLoaded: true,
    }),
    true,
  );
});

test("isMatchupHelpDismissed: visible for anonymous without local dismiss", () => {
  assert.equal(
    isMatchupHelpDismissed({
      profileDismissedAt: null,
      localDismissed: false,
      isLoggedIn: false,
      profileLoaded: false,
    }),
    false,
  );
});

test("isMatchupHelpDismissed: visible for signed-in user who has not dismissed", () => {
  assert.equal(
    isMatchupHelpDismissed({
      profileDismissedAt: null,
      localDismissed: false,
      isLoggedIn: true,
      profileLoaded: true,
    }),
    false,
  );
});

test("isMatchupHelpDismissed: profile dismiss ignored until profile loaded", () => {
  assert.equal(
    isMatchupHelpDismissed({
      profileDismissedAt: "2026-05-24T12:00:00.000Z",
      localDismissed: false,
      isLoggedIn: true,
      profileLoaded: false,
    }),
    false,
  );
});
