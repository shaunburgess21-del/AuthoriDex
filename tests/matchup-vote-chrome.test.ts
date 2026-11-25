import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  MATCHUP_UNPICKED_CLASS,
  matchupPickedFrameClass,
  matchupPickedNameBarClass,
} from "../client/src/components/matchups/matchupVoteChrome.tsx";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const versus = read("../client/src/components/matchups/VersusCard.tsx");
const detail = read("../client/src/pages/MatchupDetailPage.tsx");
const chrome = read("../client/src/components/matchups/matchupVoteChrome.tsx");

describe("matchup picked-side chrome", () => {
  it("dims the unpicked side with opacity and a light greyscale, without sizing utilities", () => {
    assert.match(MATCHUP_UNPICKED_CLASS, /\bopacity-40\b/);
    assert.match(MATCHUP_UNPICKED_CLASS, /grayscale-\[0\.35\]/);
    assert.equal(/\b(?:p|px|py|m|h|w|min-h|min-w|border-2|border-4|scale)-/.test(MATCHUP_UNPICKED_CLASS), false);
  });

  it("frames a left pick in blue and a right pick in amber, with a glow and no white ring", () => {
    const left = matchupPickedFrameClass("a");
    const right = matchupPickedFrameClass("b");

    assert.match(left, /border-blue-500/);
    assert.match(left, /dark:border-blue-400/);
    assert.match(left, /ring-blue-500\/60/);
    assert.match(left, /rgba\(59,130,246,0\.55\)/);
    assert.equal(left.includes("white"), false);
    assert.equal(left.includes("slate-300"), false);

    assert.match(right, /border-amber-500/);
    assert.match(right, /dark:border-amber-400/);
    assert.match(right, /ring-amber-500\/65/);
    assert.match(right, /rgba\(245,158,11,0\.6\)/);
    assert.equal(right.includes("white"), false);
    assert.equal(right.includes("slate-300"), false);

    assert.match(matchupPickedNameBarClass("a"), /bg-blue-100/);
    assert.match(matchupPickedNameBarClass("a"), /dark:bg-blue-950\/75/);
    assert.match(matchupPickedNameBarClass("b"), /bg-amber-100/);
    assert.match(matchupPickedNameBarClass("b"), /dark:bg-amber-950\/75/);
  });

  it("keeps the check badge absolutely positioned and hidden from assistive tech", () => {
    assert.match(chrome, /aria-hidden="true"/);
    assert.match(chrome, /absolute top-2/);
    assert.match(chrome, /side === "a"[\s\S]*left-2 bg-blue-600/);
    assert.match(chrome, /right-2 bg-amber-600/);
    assert.match(chrome, /<Check /);
  });
});

describe("matchup cards use the shared voted chrome", () => {
  for (const [name, source] of [
    ["VersusCard", versus],
    ["MatchupDetailPage", detail],
  ] as const) {
    it(`${name} paints both sides through the shared helpers`, () => {
      assert.match(source, /matchupPickedFrameClass\("a"\)/);
      assert.match(source, /matchupPickedFrameClass\("b"\)/);
      assert.match(source, /matchupPickedNameBarClass\("a"\)/);
      assert.match(source, /matchupPickedNameBarClass\("b"\)/);
      assert.match(source, /MATCHUP_UNPICKED_CLASS/);
      assert.match(source, /<MatchupPickBadge side="a"/);
      assert.match(source, /<MatchupPickBadge side="b"/);
      assert.match(source, /motion-reduce:transition-none/);
      assert.match(source, /aria-pressed=\{votedA\}/);
      assert.match(source, /aria-pressed=\{votedB\}/);
      assert.match(source, /Your pick/);
      assert.equal(source.includes("ring-white"), false);
      assert.equal(source.includes("border-slate-300/60"), false);
    });
  }

  it("leaves the pre-vote borders and the desktop height unlock untouched", () => {
    assert.match(
      versus,
      /border-border\/50 dark:border-slate-700\/50 hover:border-foreground\/30 dark:hover:border-slate-400\/50/,
    );
    assert.match(
      detail,
      /border-slate-700\/50 hover:border-slate-500\/60 dark:border-slate-400\/50/,
    );
    assert.match(
      versus,
      /feedLayout \? "h-auto min-h-\[390px\] md:h-full md:min-h-0 md:overflow-hidden" : showResults \? "h-full min-h-\[390px\] md:min-h-0" : "h-auto md:min-h-0"/,
    );
    assert.equal(versus.includes("md:min-h-[390px]"), false);
    assert.equal(versus.includes("md:h-[390px]"), false);
  });
});
