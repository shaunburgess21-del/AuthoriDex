import test from "node:test";
import assert from "node:assert/strict";

import { resolvePickContextLabel } from "../server/jobs/notification-market-labels";

test("weekly digest bestPick: gainer uses candidate over market title", () => {
  assert.equal(
    resolvePickContextLabel({
      marketType: "gainer",
      candidateName: "Clavicular",
      entryLabel: "Clavicular",
      personName: null,
    }),
    "Clavicular",
  );
});

test("weekly digest bestPick: updown uses market person", () => {
  assert.equal(
    resolvePickContextLabel({
      marketType: "updown",
      candidateName: null,
      entryLabel: "UP",
      personName: "Andrew Tate",
    }),
    "Andrew Tate",
  );
});
