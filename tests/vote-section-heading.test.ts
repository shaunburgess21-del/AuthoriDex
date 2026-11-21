import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VOTE_FEED_CUE_LABELS, VOTE_SECTION_CUE_LABELS } from "../client/src/lib/voteMixedFeed";
import {
  VOTE_CHIP_CUE_MAX_SHOWS,
  VOTE_CHIP_CUE_STORAGE_KEY,
  claimVoteChipLinkCue,
  shouldOfferVoteChipLinkCue,
  voteChipLinkCue,
  voteChipLinkCueFitsNarrowViewport,
  type VoteChipCueStore,
} from "../client/src/lib/voteChipLinkCue";

const votePage = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
const heading = readFileSync(new URL("../client/src/components/vote/VoteTypeCue.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../client/src/components/UnifiedSectionHeader.tsx", import.meta.url), "utf8");
const pill = readFileSync(new URL("../client/src/components/vote/VoteChipLinkCue.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");

const SECTION_TITLES = ["Sentiment Polls", "Matchups", "Opinion Polls", "Overall Rating"] as const;

function memoryStore(): VoteChipCueStore & { snapshot(): string | null } {
  let raw: string | null = null;
  return {
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value;
    },
    snapshot: () => raw,
  };
}

describe("vote type cue descenders", () => {
  it("keeps one-line ellipsis without clipping the line box", () => {
    assert.match(heading, /truncate keep-descenders/);
    assert.match(heading, /leading-none/);
    assert.match(css, /\.keep-descenders \{\s*padding-bottom: 0\.25em;\s*margin-bottom: -0\.25em;\s*\}/);
    const preview = readFileSync(
      new URL("../client/src/components/voices/VoiceOpinionPollPreview.tsx", import.meta.url),
      "utf8",
    );
    assert.match(preview, /truncate keep-descenders text-xs leading-none/);
  });
});

describe("vote section headings", () => {
  it("uses the plain section name on the four typed headers", () => {
    for (const title of SECTION_TITLES) {
      assert.match(votePage, new RegExp(`title="${title}"`));
      assert.equal(votePage.includes(`<VoteSectionHeading title="${title}" />`), false);
    }
    assert.equal(votePage.includes("VoteSectionHeading"), false);
    assert.equal(heading.includes("VoteSectionHeading"), false);
    assert.equal(heading.includes("voteSectionHeadingPrefix"), false);
    assert.match(votePage, /title="The Induction Queue"/);
    assert.match(votePage, /title="Curate the Profile"/);
    assert.match(votePage, /subtitle="Weigh in on current topics"/);
    assert.match(votePage, /subtitle="Vote on A vs B"/);
    assert.match(votePage, /subtitle="Your preference\. The world's verdict\."/);
    assert.match(votePage, /subtitle="Community approval rating"/);
  });

  it("restores the pre-prefix header row, with an absolute overlay slot", () => {
    assert.match(header, /title: string/);
    assert.equal(header.includes("title: React.ReactNode"), false);
    assert.match(header, /relative flex items-center justify-between px-3 py-3 md:px-5/);
    assert.match(header, /flex items-center gap-2 flex-wrap/);
    assert.match(header, /text-xl font-serif font-bold/);
    assert.match(header, /\{actions && <div className="flex items-center gap-2">\{actions\}<\/div>\}/);
    assert.equal(header.includes("gap-x-1.5"), false);
    assert.equal(header.includes("gap-y-0.5"), false);
    assert.match(header, /\{overlay\}/);
  });
});

describe("vote chip link cue", () => {
  it("pairs each chip label with its section and skips the others", () => {
    assert.equal(voteChipLinkCue("Sentiment Polls")?.text, "Agree? = Sentiment Polls");
    assert.equal(voteChipLinkCue("Matchups")?.text, "Head-to-head = Matchups");
    assert.equal(voteChipLinkCue("Opinion Polls")?.text, "Pick one = Opinion Polls");
    assert.equal(voteChipLinkCue("Overall Rating")?.text, "Rate = Overall Rating");
    for (const title of SECTION_TITLES) {
      const cue = voteChipLinkCue(title);
      assert.ok(cue);
      assert.equal(cue.chipLabel, VOTE_SECTION_CUE_LABELS[title]);
      assert.equal(cue.chipLabel, VOTE_FEED_CUE_LABELS[cue.kind]);
      assert.equal(cue.text, `${cue.chipLabel} = ${title}`);
      assert.equal(voteChipLinkCueFitsNarrowViewport(cue.text, 320), true);
    }
    for (const skipped of ["All", "Induction Queue", "Curate Profile", "The Induction Queue", "Curate the Profile"]) {
      assert.equal(voteChipLinkCue(skipped), null);
    }
  });

  it("offers the cue only after a chip tap below 768px", () => {
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Sentiment Polls", viewportWidth: 390, fromChipTap: false }),
      false,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Sentiment Polls", viewportWidth: 767, fromChipTap: true }),
      true,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Matchups", viewportWidth: 320, fromChipTap: true }),
      true,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Sentiment Polls", viewportWidth: 768, fromChipTap: true }),
      false,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Overall Rating", viewportWidth: 1280, fromChipTap: true }),
      false,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "All", viewportWidth: 390, fromChipTap: true }),
      false,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Induction Queue", viewportWidth: 390, fromChipTap: true }),
      false,
    );
    assert.equal(
      shouldOfferVoteChipLinkCue({ section: "Curate Profile", viewportWidth: 390, fromChipTap: true }),
      false,
    );
  });

  it("remembers two shows per chip in session storage and leaves other chips alone", () => {
    const store = memoryStore();
    const first = claimVoteChipLinkCue("Matchups", store);
    const second = claimVoteChipLinkCue("Matchups", store);
    const third = claimVoteChipLinkCue("Matchups", store);
    assert.equal(first?.text, "Head-to-head = Matchups");
    assert.equal(second?.text, "Head-to-head = Matchups");
    assert.equal(third, null);
    assert.equal(VOTE_CHIP_CUE_MAX_SHOWS, 2);

    const sentiment = claimVoteChipLinkCue("Sentiment Polls", store);
    assert.equal(sentiment?.text, "Agree? = Sentiment Polls");
    const saved = JSON.parse(store.snapshot() ?? "{}") as Record<string, number>;
    assert.equal(saved.Matchups, 2);
    assert.equal(saved["Sentiment Polls"], 1);
    assert.equal(Object.keys(saved).length, 2);

    const before = store.snapshot();
    assert.equal(claimVoteChipLinkCue("All", store), null);
    assert.equal(claimVoteChipLinkCue("Induction Queue", store), null);
    assert.equal(store.snapshot(), before);
  });

  it("ignores a broken stored count and stays quiet when storage throws", () => {
    const broken = memoryStore();
    broken.setItem(VOTE_CHIP_CUE_STORAGE_KEY, "{not json");
    assert.equal(claimVoteChipLinkCue("Opinion Polls", broken)?.text, "Pick one = Opinion Polls");

    const throwing: VoteChipCueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.equal(claimVoteChipLinkCue("Matchups", throwing), null);
  });

  it("mounts the cue from a chip tap only, without shifting the header", () => {
    assert.match(votePage, /const \[chipLinkCue, setChipLinkCue\] = useState<\{ nonce: number; cue: VoteChipLinkCue \} \| null>\(null\)/);
    assert.match(votePage, /onClick=\{\(\) => selectVoteSection\(section\)\}/);
    assert.match(votePage, /shouldOfferVoteChipLinkCue\(\{ section, viewportWidth, fromChipTap: true \}\)/);
    assert.match(votePage, /claimVoteChipLinkCue\(section, window\.sessionStorage\)/);
    assert.match(votePage, /setActiveSection\(sec as SectionToggle\)/);
    assert.match(votePage, /setActiveSection\(voteHubReturn\.activeSection as SectionToggle\)/);
    assert.equal(votePage.includes("selectVoteSection(voteHubReturn"), false);

    assert.match(pill, /pointer-events-none absolute left-3 top-10/);
    assert.match(pill, /md:hidden/);
    assert.match(pill, /aria-hidden="true"/);
    assert.match(pill, /whitespace-nowrap/);
    assert.match(pill, /max-w-\[calc\(100vw-8\.5rem\)\]/);
    assert.match(pill, /\{cue\.text\}/);
    assert.equal(pill.includes("Agree?"), false);

    const reduced = css.slice(css.indexOf(".vote-chip-link-cue {"));
    assert.match(css, /animation: vote-chip-link-cue 2s ease-out both/);
    assert.match(css, /@keyframes vote-section-heading-pulse/);
    assert.match(css, /@media \(max-width: 767px\) \{\s*\.vote-section-heading-pulse \{/);
    assert.match(reduced, /prefers-reduced-motion: reduce/);
    assert.match(reduced, /\.vote-chip-link-cue \{\s*animation-duration: 0\.7s !important/);
    assert.match(reduced, /\.vote-section-heading-pulse \{\s*animation: none !important/);
  });
});
