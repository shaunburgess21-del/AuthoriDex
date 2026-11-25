import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const discourse = readFileSync(
  new URL("../client/src/components/sentiment/DiscourseCard.tsx", import.meta.url),
  "utf8",
);

function resultRowSource(): string {
  const start = discourse.indexOf("function SentimentChoiceResultRow");
  const end = discourse.indexOf("export function DiscourseCard");
  assert.ok(start > 0 && end > start);
  return discourse.slice(start, end);
}

describe("sentiment result row alignment", () => {
  it("centres each row on its own bar and reserves the caption only on the pick", () => {
    const row = resultRowSource();

    assert.equal(discourse.includes("\\u00a0"), false);
    assert.equal(discourse.includes("function ChoiceLabel"), false);
    assert.match(row, /flex min-h-8 items-center gap-3/);
    assert.match(row, /grid shrink-0 grid-cols-\[1rem_4\.5rem\] items-center gap-x-3/);
    assert.match(row, /col-start-1 row-start-1 h-4 w-4/);
    assert.match(
      row,
      /col-start-2 row-start-1 w-\[4\.5rem\] whitespace-nowrap text-sm font-medium keep-descenders/,
    );
    assert.match(row, /\{chosen \? \(/);
    assert.match(
      row,
      /col-start-2 row-start-2 whitespace-nowrap text-\[9px\] font-semibold leading-3 keep-descenders/,
    );
    assert.match(row, /Your pick/);
    assert.match(row, /self-center overflow-hidden rounded-full/);
    assert.match(row, /w-10 self-center text-right text-sm text-muted-foreground/);

    const captionAt = row.indexOf("Your pick");
    const chosenAt = row.lastIndexOf("chosen ?", captionAt);
    assert.ok(chosenAt > 0 && chosenAt < captionAt);
  });
});
