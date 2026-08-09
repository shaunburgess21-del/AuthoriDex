import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOutcomeMagnitude,
  orderOutcomesForDisplay,
} from "../shared/lib/outcome-ordering";

const leg = (label: string, price: number) => ({ label, price });

test("parseOutcomeMagnitude reads brackets, thresholds and tails", () => {
  assert.equal(parseOutcomeMagnitude("$4M-$10M"), 4e6);
  assert.equal(parseOutcomeMagnitude("$15M-$50M"), 15e6);
  assert.equal(parseOutcomeMagnitude("Over $50M"), 50e6);
  assert.equal(parseOutcomeMagnitude("↑ 130m"), 130e6);
  assert.equal(parseOutcomeMagnitude("90+"), 90);
  assert.equal(parseOutcomeMagnitude("1.5B"), 1.5e9);
  assert.equal(parseOutcomeMagnitude("$1,250"), 1250);
  // Open lower tails sort before every numbered bucket.
  assert.equal(parseOutcomeMagnitude("Under $4M"), Number.NEGATIVE_INFINITY);
  assert.equal(parseOutcomeMagnitude("<15m"), Number.NEGATIVE_INFINITY);
  // No quantity at all.
  assert.equal(parseOutcomeMagnitude("The Bear"), null);
  assert.equal(parseOutcomeMagnitude(""), null);
  assert.equal(parseOutcomeMagnitude(null), null);
});

test("orderOutcomesForDisplay puts the LeBron brackets back in order", () => {
  // Exactly what the importer produced: price-descending scrambled the
  // number line, showing $15M-$50M above $10M-$15M.
  const scrambled = [
    leg("Under $4M", 1),
    leg("$4M-$10M", 0),
    leg("$15M-$50M", 0),
    leg("$10M-$15M", 0),
    leg("Over $50M", 0),
    leg("Other", 0),
  ];
  assert.deepEqual(
    orderOutcomesForDisplay(scrambled).map((o) => o.label),
    ["Under $4M", "$4M-$10M", "$10M-$15M", "$15M-$50M", "Over $50M", "Other"],
  );
});

test("orderOutcomesForDisplay keeps favourite-first for name fields", () => {
  const nominees = [
    leg("Shrinking", 0.2),
    leg("Hacks", 0.36),
    leg("The Bear", 0.15),
    leg("Abbott Elementary", 0.115),
  ];
  assert.deepEqual(
    orderOutcomesForDisplay(nominees).map((o) => o.label),
    ["Hacks", "Shrinking", "The Bear", "Abbott Elementary"],
  );
});

test("orderOutcomesForDisplay falls back to price when a leg has no quantity", () => {
  // One unparseable label must not leave the rest half-sorted.
  const mixed = [
    leg("$10M-$15M", 0.1),
    leg("Undisclosed", 0.6),
    leg("Over $50M", 0.3),
  ];
  assert.deepEqual(
    orderOutcomesForDisplay(mixed).map((o) => o.label),
    ["Undisclosed", "Over $50M", "$10M-$15M"],
  );
});

test("orderOutcomesForDisplay ignores a duplicate-magnitude field", () => {
  // "Team 1" / "Team 2" style placeholders parse as quantities but carry no
  // ordering meaning; a duplicate proves the parse is not a real number line.
  const dupes = [leg("Option 5", 0.2), leg("Choice 5", 0.5), leg("Pick 7", 0.3)];
  assert.deepEqual(
    orderOutcomesForDisplay(dupes).map((o) => o.label),
    ["Choice 5", "Pick 7", "Option 5"],
  );
});

test("orderOutcomesForDisplay always pins the catch-all last", () => {
  const withOther = [
    leg("Other", 0.9),
    leg("Hacks", 0.36),
    leg("The Bear", 0.15),
  ];
  assert.equal(orderOutcomesForDisplay(withOther).at(-1)?.label, "Other");
});
