import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  VOTE_FEED_CUE_LABELS,
  VOTE_SECTION_CUE_LABELS,
  voteSectionHeadingPrefix,
} from "../client/src/lib/voteMixedFeed";

const votePage = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
const heading = readFileSync(new URL("../client/src/components/vote/VoteTypeCue.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../client/src/components/UnifiedSectionHeader.tsx", import.meta.url), "utf8");

describe("vote section heading prefixes", () => {
  it("uses the chip cue for the four typed sections and skips the rest", () => {
    assert.deepEqual(voteSectionHeadingPrefix("Sentiment Polls"), {
      kind: "sentiment",
      label: "Agree?",
    });
    assert.deepEqual(voteSectionHeadingPrefix("Matchups"), {
      kind: "matchup",
      label: "Head-to-head",
    });
    assert.deepEqual(voteSectionHeadingPrefix("Opinion Polls"), {
      kind: "opinion",
      label: "Pick one",
    });
    assert.deepEqual(voteSectionHeadingPrefix("Overall Rating"), {
      kind: "rating",
      label: "Rate",
    });
    assert.equal(voteSectionHeadingPrefix("All"), null);
    assert.equal(voteSectionHeadingPrefix("Induction Queue"), null);
    assert.equal(voteSectionHeadingPrefix("Curate Profile"), null);
    assert.equal(voteSectionHeadingPrefix("The Induction Queue"), null);
    assert.equal(voteSectionHeadingPrefix("Curate the Profile"), null);

    for (const [section, label] of Object.entries(VOTE_SECTION_CUE_LABELS)) {
      const prefix = voteSectionHeadingPrefix(section);
      assert.ok(prefix);
      assert.equal(prefix.label, label);
      assert.equal(prefix.label, VOTE_FEED_CUE_LABELS[prefix.kind]);
    }
  });

  it("renders the chip icon and cue from that map, with the separator inside the prefix", () => {
    assert.match(heading, /return voteSectionHeadingPrefix\(section\)\?\.kind/);
    assert.match(heading, /const cue = voteSectionHeadingPrefix\(title\)/);
    assert.match(heading, /<VoteTypeCueIcon kind=\{cue\.kind\}/);
    assert.match(heading, /\{cue\.label\}/);
    assert.equal(heading.includes('"Agree?"'), false);
    assert.equal(heading.includes('"Head-to-head"'), false);
    assert.equal(heading.includes('"Pick one"'), false);
    assert.equal(heading.includes('"Rate"'), false);

    const prefixStart = heading.indexOf("whitespace-nowrap font-medium text-muted-foreground");
    const prefixEnd = heading.indexOf("vote-section-name-");
    assert.ok(prefixStart > 0 && prefixEnd > prefixStart);
    const prefix = heading.slice(prefixStart, prefixEnd);
    assert.match(prefix, /whitespace-nowrap/);
    assert.match(prefix, /text-muted-foreground/);
    assert.match(prefix, /font-medium/);
    assert.match(prefix, /h-5 w-5/);
    assert.match(prefix, /aria-hidden="true">·<\/span>/);
    assert.ok(
      prefix.indexOf('aria-hidden="true">·') < prefix.lastIndexOf("</span>"),
      "separator stays inside the nowrap prefix",
    );
  });

  it("prefixes the four vote headings and leaves Induction and Curate as names only", () => {
    for (const title of ["Sentiment Polls", "Matchups", "Opinion Polls", "Overall Rating"]) {
      assert.match(votePage, new RegExp(`<VoteSectionHeading title="${title}" />`));
    }
    assert.match(votePage, /title="The Induction Queue"/);
    assert.match(votePage, /title="Curate the Profile"/);
    assert.equal(votePage.includes('VoteSectionHeading title="The Induction Queue"'), false);
    assert.equal(votePage.includes('VoteSectionHeading title="Curate the Profile"'), false);
    assert.match(votePage, /subtitle="Weigh in on current topics"/);
    assert.match(votePage, /subtitle="Vote on A vs B"/);
    assert.match(votePage, /subtitle="Your preference\. The world's verdict\."/);
    assert.match(votePage, /subtitle="Community approval rating"/);
  });

  it("lets the heading wrap between the prefix and the name without squeezing the actions", () => {
    assert.match(header, /flex w-full min-w-0 flex-wrap items-center gap-x-1\.5 gap-y-0\.5/);
    assert.match(header, /min-w-0 flex-1/);
    const actions = header.slice(header.indexOf("{actions &&"));
    assert.match(actions, /flex shrink-0 items-center gap-2/);
  });
});
