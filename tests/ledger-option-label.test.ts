import test from "node:test";
import assert from "node:assert/strict";

import { resolveLedgerOptionLabel } from "../client/src/lib/ledger-option-label";

test("matchup ledger rows use the side's name instead of option_b", () => {
  assert.equal(
    resolveLedgerOptionLabel("Elon Musk vs Mark Zuckerberg (option_b)"),
    "Elon Musk vs Mark Zuckerberg (Mark Zuckerberg)",
  );
  assert.equal(
    resolveLedgerOptionLabel("Elon Musk vs Mark Zuckerberg (option_a)"),
    "Elon Musk vs Mark Zuckerberg (Elon Musk)",
  );
});

test("raw option ids are dropped when the two sides are not in the title", () => {
  assert.equal(resolveLedgerOptionLabel("Who wins? (option_b)"), "Who wins?");
  assert.equal(resolveLedgerOptionLabel("Weekly pick (option_a)"), "Weekly pick");
});

test("labels that are already names are left alone", () => {
  assert.equal(
    resolveLedgerOptionLabel("Elon Musk vs Mark Zuckerberg (Mark Zuckerberg)"),
    "Elon Musk vs Mark Zuckerberg (Mark Zuckerberg)",
  );
  assert.equal(resolveLedgerOptionLabel("Who wins? (A)"), "Who wins? (A)");
});
