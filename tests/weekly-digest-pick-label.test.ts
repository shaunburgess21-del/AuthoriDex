import test from "node:test";
import assert from "node:assert/strict";

import {
  formatMarketLead,
  resolvePickContextLabel,
} from "../server/jobs/notification-market-labels";

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

test("community World Markets: linked person must not lead notification copy", () => {
  assert.equal(
    resolvePickContextLabel({
      marketType: "community",
      candidateName: null,
      entryLabel: "YES England",
      personName: "Erling Haaland",
    }),
    null,
  );
});

test("community World Markets: formatMarketLead is topic-only when context is null", () => {
  const title = "Who will win Norway vs England on July 11?";
  assert.equal(formatMarketLead(title, null), title);
  assert.equal(
    formatMarketLead(
      title,
      resolvePickContextLabel({
        marketType: "community",
        candidateName: null,
        entryLabel: "YES England",
        personName: "Erling Haaland",
      }),
    ),
    title,
  );
});
