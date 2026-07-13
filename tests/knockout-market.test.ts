import test from "node:test";
import assert from "node:assert/strict";

const {
  isDrawStyleOutcomeLabel,
  looksLikeThreeWayMoneyline,
  isSingleWinnerKnockoutMarket,
  knockoutKeepIndices,
  stripDrawForKnockoutImport,
  rejectDrawWinnerOnKnockout,
} = await import("../shared/lib/knockout-market");

test("isDrawStyleOutcomeLabel matches draw/tie variants", () => {
  assert.equal(isDrawStyleOutcomeLabel("Draw"), true);
  assert.equal(isDrawStyleOutcomeLabel("draw"), true);
  assert.equal(isDrawStyleOutcomeLabel("Tie"), true);
  assert.equal(isDrawStyleOutcomeLabel("Draw (Norway vs. England)"), true);
  assert.equal(isDrawStyleOutcomeLabel("England"), false);
  assert.equal(isDrawStyleOutcomeLabel("Andrew"), false);
  assert.equal(isDrawStyleOutcomeLabel(null), false);
});

test("looksLikeThreeWayMoneyline detects classic 1X2", () => {
  assert.equal(looksLikeThreeWayMoneyline(["England", "Draw", "Norway"]), true);
  assert.equal(looksLikeThreeWayMoneyline(["Yes", "No"]), false);
  assert.equal(looksLikeThreeWayMoneyline(["France", "Spain"]), false);
});

test("stripDrawForKnockoutImport drops Draw and renormalizes prices", () => {
  const outcomes = [
    { label: "England", price: 0.515, sourceMarketId: "a", sourceOutcomeIndex: 0 },
    { label: "Draw", price: 0.265, sourceMarketId: "b", sourceOutcomeIndex: 0 },
    { label: "Norway", price: 0.235, sourceMarketId: "c", sourceOutcomeIndex: 0 },
  ];
  const labels = ["England", "Draw", "Norway"];
  const result = stripDrawForKnockoutImport(outcomes, labels);
  assert.equal(result.stripped, true);
  assert.equal(result.outcomes.length, 2);
  assert.deepEqual(
    result.labels,
    ["England", "Norway"],
  );
  const sum = result.outcomes.reduce((s, o) => s + o.price, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  assert.ok(result.outcomes[0]!.price > result.outcomes[1]!.price);
});

test("stripDrawForKnockoutImport is no-op for non-1X2", () => {
  const outcomes = [
    { label: "Yes", price: 0.6, sourceMarketId: "a", sourceOutcomeIndex: 0 },
    { label: "No", price: 0.4, sourceMarketId: "a", sourceOutcomeIndex: 1 },
  ];
  const result = stripDrawForKnockoutImport(outcomes, ["Yes", "No"]);
  assert.equal(result.stripped, false);
  assert.equal(result.outcomes.length, 2);
});

test("knockoutKeepIndices returns team indices only", () => {
  assert.deepEqual(knockoutKeepIndices(["A", "Draw", "B"]), [0, 2]);
  assert.equal(knockoutKeepIndices(["A", "B"]), null);
});

test("isSingleWinnerKnockoutMarket reads metadata flags", () => {
  assert.equal(isSingleWinnerKnockoutMarket({ singleWinnerKnockout: true }), true);
  assert.equal(isSingleWinnerKnockoutMarket({ drawEligible: false }), true);
  assert.equal(isSingleWinnerKnockoutMarket({ drawEligible: true }), false);
  assert.equal(isSingleWinnerKnockoutMarket({}), false);
  assert.equal(isSingleWinnerKnockoutMarket(null), false);
});

test("rejectDrawWinnerOnKnockout blocks Draw on flagged markets", () => {
  const blocked = rejectDrawWinnerOnKnockout({
    metadata: { singleWinnerKnockout: true },
    winnerLabel: "Draw",
  });
  assert.equal(blocked.rejected, true);

  const okTeam = rejectDrawWinnerOnKnockout({
    metadata: { singleWinnerKnockout: true },
    winnerLabel: "England",
  });
  assert.equal(okTeam.rejected, false);

  const okGroup = rejectDrawWinnerOnKnockout({
    metadata: { drawEligible: true },
    winnerLabel: "Draw",
  });
  assert.equal(okGroup.rejected, false);
});
