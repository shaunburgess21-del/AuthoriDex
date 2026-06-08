import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBriefingDisplayHeadlines,
  formatBriefingAnchorHeadline,
  formatBriefingMoverHeadline,
} from "../shared/insights/briefing-headlines";
import {
  buildDeterministicHeadline,
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
  pickLeadAnchor,
} from "../server/services/insights/story-briefing";

describe("nextBriefingRefreshIso", () => {
  it("targets the nearer of 06:00 and 18:00 UTC", () => {
    const morning = new Date("2026-06-05T10:00:00.000Z");
    const eveningTarget = new Date(nextBriefingRefreshIso(morning));
    assert.equal(eveningTarget.getUTCHours(), 18);
    assert.equal(eveningTarget.getUTCMinutes(), 0);
    assert.ok(eveningTarget.getTime() > morning.getTime());

    const lateNight = new Date("2026-06-05T20:00:00.000Z");
    const nextMorning = new Date(nextBriefingRefreshIso(lateNight));
    assert.equal(nextMorning.getUTCHours(), 6);
    assert.ok(nextMorning.getTime() > lateNight.getTime());
  });
});

describe("buildDeterministicParagraphs", () => {
  it("emits anchor beats then mover beats from whyTrending", () => {
    const paragraphs = buildDeterministicParagraphs({
      anchors: [
        {
          id: "anchor",
          name: "Donald Trump",
          rank: 2,
          change24h: -1.2,
          category: "Politics",
          whyTrending: "Donald Trump is in the news over a policy announcement.",
        },
      ],
      movers: [
        {
          id: "a",
          name: "Alice",
          rank: 49,
          change24h: 9.4,
          category: "Music",
          whyTrending: "Alice headlines a new tour announcement.",
        },
        {
          id: "b",
          name: "Bob",
          rank: 64,
          change24h: 4.2,
          category: "Film & TV",
        },
      ],
      people: [
        { id: "anchor", name: "Donald Trump" },
        { id: "a", name: "Alice" },
        { id: "b", name: "Bob" },
      ],
    });

    assert.equal(paragraphs.length, 3);
    assert.equal(paragraphs[0], "Donald Trump is in the news over a policy announcement.");
    assert.equal(paragraphs[1], "Alice headlines a new tour announcement.");
    assert.match(paragraphs[2]!, /Bob/);
    assert.ok(
      paragraphs.every((p) => !p.includes("%")),
      "prose must be number-light so it doesn't contradict live figures",
    );
  });

  it("produces deterministic story shape (headline + non-empty paragraphs)", () => {
    const inputs = {
      anchors: [],
      movers: [
        {
          id: "a",
          name: "Alice",
          rank: 49,
          change24h: 5,
          category: "Music",
        },
      ],
      people: [{ id: "a", name: "Alice" }],
    };
    const paragraphs = buildDeterministicParagraphs(inputs);

    const headline = buildDeterministicHeadline(inputs);
    const body = paragraphs.join(" ");

    assert.ok(headline.length > 0);
    assert.ok(paragraphs.length > 0);
    assert.equal(body, paragraphs.join(" "));
    assert.match(paragraphs[0]!, /Alice/);
    assert.equal(headline, "Alice leads today's biggest movers");
  });
});

describe("briefing display headlines", () => {
  it("formats mover and anchor lines", () => {
    assert.equal(
      formatBriefingMoverHeadline("Tim Cook"),
      "Tim Cook leads today's biggest movers",
    );
    assert.equal(
      formatBriefingAnchorHeadline("Donald Trump"),
      "Donald Trump leads today's news coverage",
    );
  });

  it("picks lead anchor from first briefing anchor", () => {
    assert.deepEqual(
      pickLeadAnchor([{ id: "a", name: "Donald Trump", rank: 2, change24h: 0, category: "Politics" }]),
      { id: "a", name: "Donald Trump" },
    );
    assert.equal(pickLeadAnchor([]), undefined);
  });

  it("shows both lines and dedupes when mover equals anchor", () => {
    const person = { id: "x", name: "Kim Kardashian" };
    assert.deepEqual(
      buildBriefingDisplayHeadlines({
        liveMover: person,
        leadAnchor: { id: "a", name: "Donald Trump" },
      }),
      [
        "Kim Kardashian leads today's biggest movers",
        "Donald Trump leads today's news coverage",
      ],
    );
    assert.deepEqual(
      buildBriefingDisplayHeadlines({ liveMover: person, leadAnchor: person }),
      ["Kim Kardashian leads today's biggest movers"],
    );
  });

  it("falls back to cached headline when no live mover", () => {
    assert.deepEqual(
      buildBriefingDisplayHeadlines({
        leadAnchor: { id: "a", name: "Donald Trump" },
        fallbackHeadline: "Today's influence snapshot",
      }),
      ["Today's influence snapshot", "Donald Trump leads today's news coverage"],
    );
  });
});
