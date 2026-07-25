import test from "node:test";
import assert from "node:assert/strict";
import {
  collectNetWorthCandidates,
  extractNetWorthFromSnippets,
  extractNetWorthFromText,
  isImplausibleNetWorth,
  parseNetWorthToUsd,
  personNameVariants,
  resolveNetWorthFromCandidates,
  textMentionsPerson,
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

test("extractor accepts broader web hosts when person + net-worth context + figure are present", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Kimi Antonelli Net Worth 2026",
      snippet: "Kimi Antonelli has an estimated net worth of approximately $5 million, built through his Formula 1 salary.",
      link: "https://f1salaries.com/kimi-antonelli-net-worth/",
    }],
    "Kimi Antonelli",
  );
  assert.equal(result, "$5 million");
});

test("extractor rejects broader web hosts that lack the person's name near the figure", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "F1 driver salaries",
      snippet: "The sport's top earners have a net worth of $100 million or more.",
      link: "https://f1salaries.com/rankings/",
    }],
    "Kimi Antonelli",
  );
  assert.equal(result, null);
});

test("extractor skips untrusted hosts that fail attribution (still no invented figures)", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Random blog",
      snippet: "Some actress net worth is $40 million.",
      link: "https://random-blog.example.com/sydney-sweeney",
    }],
    "Sydney Sweeney",
  );
  assert.equal(result, null);
});

test("extractor prefers trusted outlets over broader web when both disagree", () => {
  const result = extractNetWorthFromSnippets(
    [
      {
        title: "Random blog estimate",
        snippet: "Kimi Antonelli has a net worth of $18 million according to blogs.",
        link: "https://random-blog.example.com/kimi",
      },
      {
        title: "Celebrity Net Worth - Kimi Antonelli",
        snippet: "Kimi Antonelli has a net worth of $5 million as of 2026.",
        link: "https://www.celebritynetworth.com/richest-athletes/kimi-antonelli-net-worth/",
      },
    ],
    "Kimi Antonelli",
  );
  // Trusted tier wins exclusively; web $18M is ignored when a trusted figure exists.
  assert.equal(result, "$5 million");
});

test("extractor returns a compact range when trusted sources materially disagree", () => {
  const result = extractNetWorthFromSnippets(
    [
      {
        title: "Celebrity Net Worth - Kimi Antonelli",
        snippet: "Kimi Antonelli has a net worth of $5 million as of 2026.",
        link: "https://www.celebritynetworth.com/richest-athletes/kimi-antonelli-net-worth/",
      },
      {
        title: "Forbes sports wealth",
        snippet: "Kimi Antonelli net worth is estimated at $18 million after his Mercedes promotion.",
        link: "https://www.forbes.com/sites/example/kimi-antonelli/",
      },
    ],
    "Kimi Antonelli",
  );
  assert.equal(result, "$5-$18 million");
});

test("resolveNetWorthFromCandidates returns range for web-only material disagreement", () => {
  const candidates = collectNetWorthCandidates(
    [
      {
        title: "Site A",
        snippet: "Kimi Antonelli estimated net worth is $5 million.",
        link: "https://f1salaries.com/a/",
      },
      {
        title: "Site B",
        snippet: "Kimi Antonelli has a net worth of about $18 million.",
        link: "https://motorsportmoney.example.com/b/",
      },
    ],
    "Kimi Antonelli",
  );
  assert.equal(resolveNetWorthFromCandidates(candidates), "$5-$18 million");
});

test("extractor drops absurd outlier ranges (salary vs true net worth)", () => {
  const result = extractNetWorthFromSnippets(
    [
      {
        title: "Messi salary roundup",
        snippet: "Lionel Messi earns about $25 million a year; some pages list that figure near net worth chatter.",
        link: "https://sportsblog.example.com/messi-salary/",
      },
      {
        title: "Celebrity Net Worth - Lionel Messi",
        snippet: "Lionel Messi has a net worth of $1.1 billion as of 2026.",
        link: "https://www.celebritynetworth.com/richest-athletes/lionel-messi-net-worth/",
      },
      {
        title: "Forbes Messi",
        snippet: "Lionel Messi's net worth is estimated at $900 million.",
        link: "https://www.forbes.com/profile/lionel-messi/",
      },
    ],
    "Lionel Messi",
  );
  // Trusted cluster around ~$1B; $25M salary-shaped outlier must not widen the range.
  assert.equal(result, "$1.1 billion");
});

test("extractor prefers Net Worth: $5m over earlier Potential: $14m label", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Kimi Antonelli F1 page",
      snippet: "Kimi Antonelli Team: Mercedes Salary: $2m Potential: $14m Net Worth: Reportedly $5m.",
      link: "https://f1salaries.com/",
    }],
    "Kimi Antonelli",
  );
  assert.equal(result, "$5 million");
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

test("extractor rejects ranking-list misattribution (Magyar near someone else's $245m)", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Orbán's oligarchs on edge as Hungary poised to launch wealth tax",
      snippet: "Hungary's new leader, Péter Magyar, Hungarian Forbes list with an estimated net worth of $5bn. At number 27 in the rankings, with $245m, is Orbán ally Lőrinc Mészáros.",
      link: "https://www.theguardian.com/world/2026/jun/02/orban-oligarchs-on-edge-hungary-wealth-tax-peter-magyar",
    }],
    "Péter Magyar",
  );
  assert.equal(result, null);
});

test("extractor prefers net-worth figure over nearby salary figure", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Max Verstappen Net Worth 2026",
      snippet: "Highest-paid driver in F1, earning an estimated $65 million annually, with a net worth around $250 million thanks to salary, endorsements, and investments.",
      link: "https://www.formulaonehistory.com/max-verstappen-net-worth/",
    }],
    "Max Verstappen",
  );
  assert.equal(result, "$250 million");
});

test("extractor matches spaced stage names to compacted variants (Mr Beast / MrBeast)", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "MrBeast Net Worth",
      snippet: "What is MrBeast's Net Worth? MrBeast is an American YouTube star who has a net worth of $2.6 billion.",
      link: "https://www.celebritynetworth.com/richest-businessmen/producers/jimmy-donaldson-aka-mrbeast-net-worth/",
    }],
    "Mr Beast",
  );
  assert.equal(result, "$2.6 billion");
});

test("normalizeMoney expands shorthand units", async () => {
  const { normalizeMoney } = await import("../server/services/net-worth-extraction");
  assert.equal(normalizeMoney("$245m"), "$245 million");
  assert.equal(normalizeMoney("$1.5B"), "$1.5 billion");
});

test("parseNetWorthToUsd applies trailing unit to inline ranges", () => {
  assert.equal(parseNetWorthToUsd("$5-$18 million"), 11_500_000);
  assert.equal(parseNetWorthToUsd("$5 to $18M"), 11_500_000);
});

test("inline range snippets do not collapse to raw-dollar candidates", () => {
  const result = extractNetWorthFromSnippets(
    [{
      title: "Kimi Antonelli net worth range",
      snippet: "Kimi Antonelli has an estimated net worth of $5-$18 million according to recent roundups.",
      link: "https://f1salaries.com/kimi-antonelli-net-worth/",
    }],
    "Kimi Antonelli",
  );
  assert.equal(result, "$5-$18 million");
});

test("parenthetical stage names do not match unrelated first names", () => {
  const variants = personNameVariants("Lisa (Blackpink)");
  assert.ok(variants.includes("lisa (blackpink)"));
  assert.ok(variants.includes("lisa blackpink"));
  assert.ok(!variants.includes("lisa"));

  assert.equal(
    textMentionsPerson("Lisa Su has a net worth of $1 billion as AMD CEO.", "Lisa (Blackpink)"),
    false,
  );
  assert.equal(
    textMentionsPerson("Lisa (Blackpink) has a net worth of $40 million.", "Lisa (Blackpink)"),
    true,
  );
});
