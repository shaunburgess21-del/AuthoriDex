import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const preview = readFileSync(
  new URL("../client/src/components/voices/VoiceEntityPreview.tsx", import.meta.url),
  "utf8",
);
const surface = readFileSync(
  new URL("../client/src/components/voices/voicesSurface.ts", import.meta.url),
  "utf8",
);
const world = readFileSync(
  new URL("../client/src/components/voices/VoiceWorldMarketPreview.tsx", import.meta.url),
  "utf8",
);

describe("voices embed headings", () => {
  it("wraps world-market titles up to three lines and keeps the card image-height", () => {
    assert.match(preview, /break-words text-sm font-medium leading-snug/);
    assert.match(preview, /const MARKET_TITLE_CLASS = `\$\{BANNER_TITLE_BASE\} line-clamp-3`/);
    assert.match(preview, /const MULTI_MARKET_TITLE_CLASS = `\$\{BANNER_TITLE_BASE\} line-clamp-2 sm:line-clamp-3`/);
    assert.match(
      preview,
      /worldMarketPreview\?\.layout === "multi"[\s\S]*?MULTI_MARKET_TITLE_CLASS[\s\S]*?: MARKET_TITLE_CLASS/,
    );
    const banner = preview.slice(
      preview.indexOf("const BANNER_TITLE_BASE"),
      preview.indexOf("const MARKET_TITLE_CLASS"),
    );
    assert.match(banner, /leading-snug/);
    assert.equal(banner.includes("leading-none"), false);
    assert.match(surface, /export const VOICES_ENTITY_PREVIEW_HEIGHT_CLASS = "h-44 sm:h-56"/);
    assert.match(world, /justify-end/);
  });

  it("wraps sentiment and opinion headings instead of a one-line clamp", () => {
    assert.match(preview, /const POLL_TITLE_CLASS = `\$\{BANNER_TITLE_BASE\} line-clamp-2 sm:line-clamp-3`/);
    assert.match(preview, /isSentimentPoll \? \([\s\S]*?className=\{POLL_TITLE_CLASS\}/);
    assert.match(preview, /isOpinionPoll \? \([\s\S]*?className=\{POLL_TITLE_CLASS\}/);
    assert.equal(/shrink-0 line-clamp-1 text-sm font-medium/.test(preview), false);
  });

  it("leaves matchup name footers and profile meta on one line", () => {
    assert.match(preview, /block truncate text-sm font-semibold text-foreground/);
    assert.match(preview, /line-clamp-1 shrink text-sm font-medium leading-snug/);
  });
});
