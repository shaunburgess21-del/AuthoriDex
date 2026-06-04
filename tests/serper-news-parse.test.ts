import test from "node:test";
import assert from "node:assert/strict";

import {
  articleMatchesRelevance,
  buildSerperNewsQuery,
  buildSerperRelevanceSpec,
  normalizeNewsMatchText,
} from "../server/providers/serper-news-parse";

test("buildSerperNewsQuery: override passthrough", () => {
  assert.equal(
    buildSerperNewsQuery("Lisa (Blackpink)", "Lisa BLACKPINK"),
    "Lisa BLACKPINK",
  );
});

test("buildSerperNewsQuery: expands parenthetical", () => {
  assert.equal(buildSerperNewsQuery("Lisa (Blackpink)", null), "Lisa Blackpink");
});

test("buildSerperNewsQuery: plain multi-word name unchanged", () => {
  assert.equal(buildSerperNewsQuery("Donald Trump", null), "Donald Trump");
});

test("buildSerperRelevanceSpec: requires all tokens from query", () => {
  const spec = buildSerperRelevanceSpec("Lisa BLACKPINK");
  assert.ok(articleMatchesRelevance("BLACKPINK Lisa drives Ferrari", undefined, spec));
  assert.equal(
    articleMatchesRelevance("Japan World Cup championship vision", undefined, spec),
    false,
  );
});

test("buildSerperRelevanceSpec: Lisa Su requires both tokens", () => {
  const spec = buildSerperRelevanceSpec("Lisa Su");
  assert.ok(articleMatchesRelevance("AMD CEO Lisa Su on chips", "Interview", spec));
  assert.equal(
    articleMatchesRelevance("BLACKPINK Lisa birthday", undefined, spec),
    false,
  );
});

test("articleMatchesRelevance: short token does not match inside a word", () => {
  const spec = buildSerperRelevanceSpec("Lisa Su");
  // "su" must not match "supports" / "Sunday".
  assert.equal(
    articleMatchesRelevance("BLACKPINK Lisa supports charity on Sunday", undefined, spec),
    false,
  );
  // Genuine "Su" as a standalone word still matches.
  assert.ok(articleMatchesRelevance("Lisa Su unveils new GPU", undefined, spec));
});

test("articleMatchesRelevance: possessive and hyphen boundaries", () => {
  const blackpink = buildSerperRelevanceSpec("Lisa BLACKPINK");
  assert.ok(
    articleMatchesRelevance("Lisa's new era with BLACKPINK", undefined, blackpink),
  );
});

test("articleMatchesRelevance: accent fold Rosé / rose", () => {
  const spec = buildSerperRelevanceSpec("Rosé BLACKPINK");
  assert.ok(
    articleMatchesRelevance(
      "BLACKPINK Rose makes history",
      "The singer Rose from BLACKPINK",
      spec,
    ),
  );
});

test("normalizeNewsMatchText: strips diacritics", () => {
  assert.equal(normalizeNewsMatchText("Rosé"), "rose");
});

test("buildSerperRelevanceSpec: OR branches", () => {
  const spec = buildSerperRelevanceSpec('"Lalisa Manobal" OR Lisa BLACKPINK');
  assert.ok(spec.anyOf.length >= 2);
  assert.ok(
    articleMatchesRelevance("Lisa from BLACKPINK at event", undefined, spec),
  );
  assert.equal(
    articleMatchesRelevance("Unrelated sports headline", undefined, spec),
    false,
  );
});

test("articleMatchesRelevance: empty spec passes through", () => {
  const spec = buildSerperRelevanceSpec("");
  assert.equal(articleMatchesRelevance("Anything", "Here", spec), true);
});
