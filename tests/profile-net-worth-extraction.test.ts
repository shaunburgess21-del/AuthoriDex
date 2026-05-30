import test from "node:test";
import assert from "node:assert/strict";
import {
  extractNetWorthFromSnippets,
  extractNetWorthFromText,
  isImplausibleNetWorth,
  parseNetWorthToUsd,
  type NetWorthSnippet,
} from "../server/services/net-worth-extraction";

function snippet(text: string, link = "https://www.forbes.com/profile/example/"): NetWorthSnippet {
  return { title: "Forbes profile", snippet: text, link };
}

test("extractor returns figure when person's full name is near it", () => {
  const result = extractNetWorthFromSnippets(
    [snippet("Sydney Sweeney is an American actress with an estimated net worth of $40 million.")],
    "Sydney Sweeney",
  );
  assert.equal(result, "$40 million");
});

test("extractor rejects figure when querying person is not in the snippet (Musk leak to Farage)", () => {
  // Real-world failure shape that produced the Farage/Starmer $828B mis-grab:
  // a snippet about Musk that shows up in Farage's net-worth search but
  // doesn't mention Farage at all.
  const result = extractNetWorthFromSnippets(
    [snippet("Elon Musk's net worth is estimated at $828 billion, making him the richest person.")],
    "Nigel Farage",
  );
  assert.equal(result, null);
});

test("extractor accepts the same Musk snippet when querying for Musk himself", () => {
  const result = extractNetWorthFromSnippets(
    [snippet("Elon Musk's net worth is estimated at $828 billion, making him the richest person.")],
    "Elon Musk",
  );
  assert.equal(result, "$828 billion");
});

test("extractor accepts when the querying person's name is in the same sentence as the figure", () => {
  const result = extractNetWorthFromSnippets(
    [snippet("Jeff Bezos has a net worth of $272 billion, trailing rival Elon Musk in the rankings.")],
    "Jeff Bezos",
  );
  assert.equal(result, "$272 billion");
});

test("extractor's proximity gate is window-based, not linguistic - LLM handles ambiguity", () => {
  // Documents intentional behavior: when BOTH names appear within the
  // proximity window, the extractor doesn't try to figure out which one
  // owns the figure. That's the LLM's job (via its strengthened prompt).
  // The extractor's only contract is "reject snippets that don't mention
  // the person at all near the figure" — which catches the actually-
  // reported bug class (Musk article surfacing in a Farage query where
  // Farage isn't in the snippet at all).
  const result = extractNetWorthFromSnippets(
    [snippet("Elon Musk leads with $835 billion net worth, ahead of rival Jeff Bezos in the rankings.")],
    "Jeff Bezos",
  );
  // Either outcome is acceptable here; what matters is the downstream
  // LLM has both names and the figure in its prompt with an attribution
  // instruction. We just want the test to lock in the current behavior.
  assert.equal(result, "$835 billion");
});

test("extractor rejects implausible $20T figure even when attributed to the person", () => {
  // Real-world shape of the Gates/Bezos $20.1T mis-grab — a non-net-worth
  // figure (likely market cap / GDP) sitting near both the person's name
  // and the words "net worth". The absurd-only $5T ceiling catches it.
  const result = extractNetWorthFromSnippets(
    [snippet("Bill Gates net worth reaches $20.1 trillion this year, analysts say.")],
    "Bill Gates",
  );
  assert.equal(result, null);
});

test("ceiling allows current Musk-scale wealth ($835B) and well above", () => {
  // Sanity: real top-of-the-planet figures must pass. The old $500B
  // ceiling would have wrongly blocked Musk's actual current net worth.
  assert.equal(isImplausibleNetWorth("$835 billion"), false);
  assert.equal(isImplausibleNetWorth("$1.2 trillion"), false);
  assert.equal(isImplausibleNetWorth("$4.9 trillion"), false);
});

test("ceiling rejects clearly-absurd figures", () => {
  assert.equal(isImplausibleNetWorth("$20.1 trillion"), true);
  assert.equal(isImplausibleNetWorth("$100 trillion"), true);
});

test("parseNetWorthToUsd handles standard units", () => {
  assert.equal(parseNetWorthToUsd("$40 million"), 40_000_000);
  assert.equal(parseNetWorthToUsd("$1.2 billion"), 1_200_000_000);
  assert.equal(parseNetWorthToUsd("$2 trillion"), 2_000_000_000_000);
  assert.equal(parseNetWorthToUsd("$500 thousand"), 500_000);
});

test("extractor skips untrusted hosts entirely", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Random blog",
      snippet: "Sydney Sweeney net worth is $40 million.",
      link: "https://random-blog.example.com/sydney-sweeney",
    }],
    "Sydney Sweeney",
  );
  assert.equal(result, null);
});

test("extractor falls through to a later source when the first lacks attribution", () => {
  const result = extractNetWorthFromSnippets(
    [
      {
        title: "Forbes billionaires list",
        snippet: "Elon Musk and Mark Zuckerberg lead the rankings with $835 billion and $250 billion respectively.",
        link: "https://www.forbes.com/billionaires/",
      },
      {
        title: "Celebrity Net Worth - Jeff Bezos",
        snippet: "Jeff Bezos has a net worth of approximately $272 billion as of 2026.",
        link: "https://www.celebritynetworth.com/richest-businessmen/jeff-bezos-net-worth/",
      },
    ],
    "Jeff Bezos",
  );
  assert.equal(result, "$272 billion");
});

test("extractNetWorthFromText handles OpenAI augmentation blocks", () => {
  const text = `Research notes for Sydney Sweeney:
- Born in 1997 in Spokane, Washington.
- Estimated net worth around $40 million according to Celebrity Net Worth.
- Major roles include Euphoria, The White Lotus.`;
  const result = extractNetWorthFromText(text, "Sydney Sweeney");
  assert.equal(result, "$40 million");
});

test("extractNetWorthFromText rejects when the queried person isn't anywhere near the figure", () => {
  // Sydney Sweeney is genuinely not in this text — only Zuckerberg is.
  // This is the bug-shape the extractor must catch.
  const text = `Research notes for Mark Zuckerberg: net worth is around $250 billion as of 2026, primarily from Meta holdings. The figure is widely tracked by Forbes and Bloomberg billionaire indices.`;
  const result = extractNetWorthFromText(text, "Sydney Sweeney");
  assert.equal(result, null);
});
