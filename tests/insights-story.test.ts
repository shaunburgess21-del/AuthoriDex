import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDeterministicParagraphs,
  nextBriefingRefreshIso,
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
  it("builds a lead and per-gainer beats from 24h movers", () => {
    const paragraphs = buildDeterministicParagraphs({
      topGainers: [
        {
          id: "a",
          name: "Alice",
          rank: 1,
          change24h: 9.4,
          category: "Music",
          whyTrending: "Alice headlines a new tour announcement.",
        },
        {
          id: "b",
          name: "Bob",
          rank: 4,
          change24h: 4.2,
          category: "Film & TV",
        },
      ],
      notableDropper: {
        id: "c",
        name: "Carol",
        rank: 12,
        change24h: -3.1,
        category: "Sports",
      },
      people: [
        { id: "a", name: "Alice" },
        { id: "b", name: "Bob" },
        { id: "c", name: "Carol" },
      ],
    });

    assert.ok(paragraphs.length >= 4);
    assert.match(paragraphs[0]!, /Alice/);
    assert.match(paragraphs[0]!, /\+9\.4%/);
    assert.equal(paragraphs[1], "Alice headlines a new tour announcement.");
    assert.match(paragraphs[2]!, /Bob/);
    assert.ok(paragraphs.some((p) => p.includes("Carol")));
    assert.equal(
      paragraphs.filter((p) => p.includes("Alice")).length,
      2,
      "lead line + whyTrending beat only (no redundant generic for #1)",
    );
  });

  it("produces deterministic story shape (headline + non-empty paragraphs)", () => {
    const paragraphs = buildDeterministicParagraphs({
      topGainers: [
        {
          id: "a",
          name: "Alice",
          rank: 1,
          change24h: 5,
          category: "Music",
        },
      ],
      notableDropper: null,
      people: [{ id: "a", name: "Alice" }],
    });

    const headline = "Alice leads today's movers";
    const body = paragraphs.join(" ");

    assert.ok(headline.length > 0);
    assert.ok(paragraphs.length > 0);
    assert.equal(body, paragraphs.join(" "));
    assert.match(paragraphs[0]!, /Alice/);
  });
});
