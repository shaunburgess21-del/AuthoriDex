import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type CatalogSnapshot,
  MIN_FIT_SCORE,
  buildDenyKeySet,
  buildSystemPrompt,
  buildUserPrompt,
  contentTypeToSuggestionType,
  defaultBreakingEndAt,
  ensureBreakingEndAt,
  filterAgainstDenyList,
  formatReviewLearningsBlock,
  ideaDedupeKey,
  isVoteScoutMode,
  matchupCanonicalKey,
  normalizeTitleKey,
  parseVoteScoutResponse,
  titleFromScoutPayload,
} from "../server/jobs/vote-scout-core";

function sampleCatalog(overrides: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    matchupTitles: ["Dogs vs Cats", "Coffee vs Tea"],
    sentimentHeadlines: ["Pineapple on Pizza"],
    opinionTitles: ["Greatest boxer of all time"],
    priorIdeaTitles: ["Window Seat vs Aisle Seat"],
    categoryCounts: {
      matchup: { "food-drink": 2 },
      sentiment_poll: { lifestyle: 1 },
      opinion_poll: { sports: 1 },
    },
    styleSamples: {
      matchups: ["Coffee vs Tea | prompt: Morning ritual?"],
      sentiments: ["Pineapple on Pizza | Few food debates divide people"],
      opinions: ["Greatest boxer of all time | Classic GOAT debate"],
    },
    reviewLearnings: { kept: [], dismissed: [] },
    leaderboardNames: ["Taylor Swift", "Elon Musk", "Lionel Messi"],
    inductionNames: ["Some Newcomer"],
    ...overrides,
  };
}

describe("vote-scout-core normalization", () => {
  it("normalizes punctuation and case", () => {
    assert.equal(normalizeTitleKey("  Dogs, vs Cats! "), "dogs vs cats");
  });

  it("treats reversed matchup sides as the same key", () => {
    assert.equal(matchupCanonicalKey("Dogs vs Cats"), matchupCanonicalKey("Cats vs Dogs"));
    assert.equal(matchupCanonicalKey("iOS vs Android"), matchupCanonicalKey("Android vs iOS"));
  });

  it("keeps non-vs titles as plain keys", () => {
    assert.equal(matchupCanonicalKey("Pineapple on Pizza"), "pineapple on pizza");
  });
});

describe("vote-scout-core deny list", () => {
  it("blocks reversed matchups and prior ideas across types", () => {
    const deny = buildDenyKeySet(sampleCatalog());
    assert.equal(deny.has(ideaDedupeKey("matchup", "Cats vs Dogs")), true);
    assert.equal(deny.has(ideaDedupeKey("matchup", "Window Seat vs Aisle Seat")), true);
    assert.equal(deny.has(ideaDedupeKey("sentiment_poll", "Pineapple on Pizza")), true);
    assert.equal(deny.has(ideaDedupeKey("opinion_poll", "Brand new topic")), false);
  });

  it("includes deny titles, people context, and next-tier guidance in the user prompt", () => {
    const prompt = buildUserPrompt(sampleCatalog(), "evergreen");
    assert.match(prompt, /Dogs vs Cats/);
    assert.match(prompt, /Window Seat vs Aisle Seat/);
    assert.match(prompt, /CATEGORY COVERAGE/);
    assert.match(prompt, /next tier/i);
    assert.match(prompt, /Taylor Swift/);
    assert.match(prompt, /TRACKED PEOPLE/);
    assert.match(prompt, /Do not include image prompts/);
    assert.match(prompt, new RegExp(`fitScore >= ${MIN_FIT_SCORE}`));
  });

  it("mentions topical people debates and no image prompts in system prompt", () => {
    assert.match(buildSystemPrompt("topical"), /web search/i);
    assert.match(buildSystemPrompt("topical"), /TRACKED PEOPLE/);
    assert.match(buildSystemPrompt("topical"), /reality-TV casting|reality\/entertainment/i);
    assert.match(buildSystemPrompt("evergreen"), /no web search/i);
    const evergreen = buildSystemPrompt("evergreen");
    assert.match(evergreen, /dinner[- ]party/i);
    assert.match(evergreen, /online-debate test/i);
    assert.match(evergreen, /CONCEPT vs CONCEPT/i);
    assert.match(evergreen, /Never pad/i);
    assert.match(evergreen, /Do NOT generate image prompts/i);
    assert.doesNotMatch(evergreen, /optionAImagePrompt/);
    assert.match(evergreen, /relatedNames/);
    assert.match(evergreen, new RegExp(String(MIN_FIT_SCORE)));
    assert.match(evergreen, /Invasive (celebrity )?gossip/i);
    assert.match(evergreen, /Light, try-worthy public-figure/i);
  });

  it("uses a short-lived breaking rubric with web search and invasive-gossip exclusions", () => {
    const breaking = buildSystemPrompt("breaking");
    assert.match(breaking, /MODE: BREAKING/i);
    assert.match(breaking, /web search/i);
    assert.match(breaking, /SHORT-LIVED|short-lived/i);
    assert.match(breaking, /do not default to sports only/i);
    assert.match(breaking, /suggestedEndAt/);
    assert.match(breaking, /3–14 days|days–weeks/i);
    assert.match(breaking, /Invasive (celebrity )?gossip/i);
    assert.match(breaking, /Light, try-worthy gossip/i);
    assert.match(breaking, /are NOT excluded/i);
    assert.match(breaking, /do NOT need to be timeless/i);
    assert.match(breaking, /Prefer CURRENT controversies/i);
    assert.doesNotMatch(breaking, /still makes sense in ~12 months/);
    assert.doesNotMatch(breaking, /Dig for the NEXT TIER/);
    // Example end date should not be null for breaking (models mirror the schema).
    assert.match(breaking, /"suggestedEndAt": "20\d{2}-\d{2}-\d{2}/);
  });

  it("steers breaking user prompts toward current debates", () => {
    const prompt = buildUserPrompt(sampleCatalog(), "breaking");
    assert.match(prompt, /Scan mode: breaking/);
    assert.match(prompt, /CURRENT short-lived debates/i);
    assert.doesNotMatch(prompt, /Dig for the next tier/i);
  });
});

describe("vote-scout-core parsing", () => {
  it("parses a valid mixed response with relatedNames and drops low fit", () => {
    const raw = JSON.stringify({
      ideas: [
        {
          contentType: "matchup",
          fitScore: 88,
          rationale: "Classic preference split",
          relatedNames: ["Lionel Messi"],
          suggestedEndAt: null,
          payload: {
            title: "Window Seat vs Aisle Seat",
            promptText: "Every flight, the same silent judgment.",
            optionAText: "Window Seat",
            optionBText: "Aisle Seat",
            category: "travel",
            description: "Two ways to fly.",
          },
        },
        {
          contentType: "sentiment_poll",
          fitScore: 40,
          rationale: "Too weak",
          payload: {
            headline: "Weak idea",
            subjectText: "Nope",
            category: "misc",
            description: "",
          },
        },
        {
          contentType: "opinion_poll",
          fitScore: 75,
          rationale: "Generational warfare",
          relatedNames: [],
          payload: {
            title: "Best decade for music",
            category: "music",
            summary: "Pick the decade.",
            options: ["1960s", "1970s", "1980s", "1990s", "2000s", "2010s"],
          },
        },
      ],
    });

    const parsed = parseVoteScoutResponse(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].contentType, "matchup");
    assert.deepEqual(parsed[0].relatedNames, ["Lionel Messi"]);
    assert.equal((parsed[0] as any).imagePrompt, undefined);
    assert.equal(parsed[1].contentType, "opinion_poll");
  });

  it("drops ideas below the quality floor", () => {
    const raw = JSON.stringify({
      ideas: [
        {
          contentType: "sentiment_poll",
          fitScore: MIN_FIT_SCORE - 1,
          rationale: "borderline",
          payload: {
            headline: "Almost good enough",
            subjectText: "Not quite.",
            category: "lifestyle",
            description: "",
          },
        },
      ],
    });
    assert.equal(parseVoteScoutResponse(raw).length, 0);
  });

  it("returns empty for malformed JSON", () => {
    assert.deepEqual(parseVoteScoutResponse("not json"), []);
    assert.deepEqual(parseVoteScoutResponse('{"ideas":[]}'), []);
  });

  it("rejects opinion polls with too few options", () => {
    const raw = JSON.stringify({
      ideas: [
        {
          contentType: "opinion_poll",
          fitScore: 90,
          rationale: "thin options",
          payload: {
            title: "Pick one",
            category: "misc",
            summary: "x",
            options: ["A", "B"],
          },
        },
      ],
    });
    assert.equal(parseVoteScoutResponse(raw).length, 0);
  });

  it("filters duplicates against deny list and within batch", () => {
    const deny = buildDenyKeySet(sampleCatalog());
    const ideas = parseVoteScoutResponse(
      JSON.stringify({
        ideas: [
          {
            contentType: "matchup",
            fitScore: 90,
            rationale: "dupe",
            payload: {
              title: "Cats vs Dogs",
              promptText: "Who wins?",
              optionAText: "Cats",
              optionBText: "Dogs",
              category: "lifestyle",
              description: "",
            },
          },
          {
            contentType: "sentiment_poll",
            fitScore: 80,
            rationale: "fresh",
            payload: {
              headline: "Tipping culture has gone too far",
              subjectText: "Debate tipping norms.",
              category: "lifestyle",
              description: "",
            },
          },
          {
            contentType: "sentiment_poll",
            fitScore: 79,
            rationale: "same batch dupe",
            payload: {
              headline: "Tipping culture has gone too far",
              subjectText: "Debate tipping norms again.",
              category: "lifestyle",
              description: "",
            },
          },
        ],
      }),
    );

    const { kept, skippedDuplicates } = filterAgainstDenyList(ideas, deny);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].displayTitle, "Tipping culture has gone too far");
    assert.equal(skippedDuplicates, 2);
  });
});

describe("vote-scout-core review learnings", () => {
  it("includes founder learnings in the user prompt when present", () => {
    const prompt = buildUserPrompt(
      sampleCatalog({
        reviewLearnings: {
          kept: [
            {
              status: "kept",
              contentType: "matchup",
              title: "Subtitles On vs Subtitles Off",
              note: "Perfect modern debate",
            },
          ],
          dismissed: [
            {
              status: "dismissed",
              contentType: "matchup",
              title: "Fork & Knife vs Hands",
              note: "Too niche for food-drink",
            },
          ],
        },
      }),
      "evergreen",
    );
    assert.match(prompt, /FOUNDER REVIEW LEARNINGS/);
    assert.match(prompt, /why kept: Perfect modern debate/);
    assert.match(prompt, /why rejected: Too niche for food-drink/);
  });

  it("formats review learnings block", () => {
    const block = formatReviewLearningsBlock({
      kept: [
        {
          status: "kept",
          contentType: "sentiment_poll",
          title: "First dates should be split 50/50",
          note: null,
        },
      ],
      dismissed: [
        {
          status: "dismissed",
          contentType: "opinion_poll",
          title: "How do you prefer to recharge socially?",
          note: "Title is ambiguous",
        },
      ],
    });
    assert.match(block, /FOUNDER APPROVED/);
    assert.match(block, /FOUNDER REJECTED/);
    assert.match(block, /Title is ambiguous/);
  });

  it("extracts title from payload", () => {
    assert.equal(titleFromScoutPayload({ headline: "Spoiler warnings" }), "Spoiler warnings");
    assert.equal(titleFromScoutPayload({ title: "Coffee vs Tea" }), "Coffee vs Tea");
  });
});

describe("vote-scout-core type mapping", () => {
  it("maps content types to suggestion types", () => {
    assert.equal(contentTypeToSuggestionType("matchup"), "matchup");
    assert.equal(contentTypeToSuggestionType("sentiment_poll"), "sentiment_poll");
    assert.equal(contentTypeToSuggestionType("opinion_poll"), "opinion_poll");
  });

  it("validates scout modes including breaking", () => {
    assert.equal(isVoteScoutMode("evergreen"), true);
    assert.equal(isVoteScoutMode("topical"), true);
    assert.equal(isVoteScoutMode("breaking"), true);
    assert.equal(isVoteScoutMode("flash"), false);
  });

  it("defaults and clamps breaking suggestedEndAt", () => {
    const now = new Date("2026-07-19T10:00:00.000Z");
    const ideas = ensureBreakingEndAt(
      [
        {
          contentType: "sentiment_poll",
          payload: {
            headline: "Was the penalty fair?",
            subjectText: "Debate.",
            category: "sports",
            description: "",
          },
          rationale: "hot take",
          fitScore: 80,
          suggestedEndAt: null,
          relatedNames: [],
          displayTitle: "Was the penalty fair?",
        },
        {
          contentType: "sentiment_poll",
          payload: {
            headline: "Far future",
            subjectText: "Debate.",
            category: "sports",
            description: "",
          },
          rationale: "hot take",
          fitScore: 80,
          suggestedEndAt: "2027-12-01T00:00:00.000Z",
          relatedNames: [],
          displayTitle: "Far future",
        },
      ],
      now,
    );
    assert.equal(ideas[0].suggestedEndAt, defaultBreakingEndAt(now));
    assert.equal(ideas[1].suggestedEndAt?.startsWith("2026-08-02"), true);
  });
});
