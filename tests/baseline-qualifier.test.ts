import test from "node:test";
import assert from "node:assert/strict";
import {
  hasBaselineQualifier,
  computeBaselineQualifierAdvice,
} from "../shared/lib/baseline-qualifier";

test("hasBaselineQualifier spots comparative questions only", () => {
  assert.equal(
    hasBaselineQualifier("Will Zendaya and Robert Pattinson be announced for another movie together in 2026?"),
    true,
  );
  assert.equal(hasBaselineQualifier("Will Avengers: Doomsday get delayed again?"), true);
  assert.equal(hasBaselineQualifier("Will she release a second album in 2026?"), true);
  // "The next <recurring award>" is well defined, not a comparison.
  assert.equal(hasBaselineQualifier("Who will win the next Ballon d'Or?"), false);
  assert.equal(hasBaselineQualifier("Who will win the 2026 Emmy for Lead Actor?"), false);
});

test("flags the criteria that let the scout resolve on the baseline", () => {
  // Verbatim from the market that triggered this: the film they were already
  // cast in satisfied these criteria, and the scout proposed Yes at 99%.
  const advice = computeBaselineQualifierAdvice({
    title: "Will Zendaya and Robert Pattinson be announced for another movie together in 2026?",
    criteria: [
      "Resolves 'Yes' if an official announcement in 2026 confirms Zendaya and Robert Pattinson are both cast in the same film project.",
      "Rumors, reported talks, or unconfirmed trade scoops alone do not count.",
    ],
  });
  assert.equal(advice.flagged, true);
  assert.equal(advice.qualifier, "another");
  assert.match(advice.reason, /already exists/i);
});

test("accepts criteria that anchor the baseline, however they phrase it", () => {
  // Every one of these is a real market that got it right.
  const cases: Array<{ title: string; criteria: string[] }> = [
    {
      title: "Will Avengers: Doomsday get delayed again?",
      criteria: [
        "Resolves to Yes if Marvel, Disney, or another authorized official source announces a new release date later than December 18, 2026.",
      ],
    },
    {
      title: "Will Joe Rogan interview Donald Trump again before 31 Dec 2026?",
      criteria: [
        "A new Joe Rogan Experience episode featuring Donald Trump is officially published on or after the market open date and before 31 Dec 2026.",
      ],
    },
    {
      title: "Will Zohran Mamdani release another song before 2027?",
      criteria: [
        "Resolves 'Yes' if Zohran Mamdani officially releases a new song or single by December 31, 2026.",
        "Re-releases, remixes, and alternate versions of older songs do not count as new releases.",
      ],
    },
  ];
  for (const c of cases) {
    const advice = computeBaselineQualifierAdvice({
      title: c.title,
      criteria: c.criteria,
    });
    assert.equal(advice.flagged, false, `${c.title} should not be flagged`);
  }
});

test("the repaired criteria clear the flag", () => {
  const advice = computeBaselineQualifierAdvice({
    title: "Will Zendaya and Robert Pattinson be announced for another movie together in 2026?",
    criteria: [
      "Resolves Yes only if a NEW film pairing Zendaya and Robert Pattinson is officially announced during 2026 — a project additional to any they were already attached to together before 2026.",
      "Films they were already jointly cast in before 2026 are the baseline and never count.",
    ],
  });
  assert.equal(advice.flagged, false);
});

test("non-comparative markets are never flagged", () => {
  const advice = computeBaselineQualifierAdvice({
    title: "Which film will win the 2027 Oscar for Best Cinematography?",
    criteria: ["The film awarded Best Cinematography at the ceremony."],
  });
  assert.equal(advice.flagged, false);
  assert.equal(advice.qualifier, null);
});

test("missing criteria on a comparative title still flags", () => {
  const advice = computeBaselineQualifierAdvice({
    title: "Will they tour together again in 2026?",
    criteria: null,
  });
  assert.equal(advice.flagged, true);
});
