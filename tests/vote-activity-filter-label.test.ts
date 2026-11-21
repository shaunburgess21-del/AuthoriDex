import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("vote activity filter label", () => {
  const source = readFileSync(
    new URL("../client/src/components/VoteActivityFilterFab.tsx", import.meta.url),
    "utf8",
  );

  it("sits above the eye, outside the backdrop-blur button that was clipping it", () => {
    assert.equal(source.includes("absolute bottom-[calc(100%+8px)]"), false);
    const labelAt = source.indexOf("activity-filter-label");
    const buttonAt = source.indexOf("data-testid={testId}");
    assert.ok(labelAt > 0 && buttonAt > labelAt);
    assert.match(source, /data-testid=\{`\$\{testId\}-label`\}/);
    assert.match(source, /mb-2 whitespace-nowrap rounded-full/);
    const buttonClass = source.slice(buttonAt, source.indexOf(">", buttonAt));
    assert.equal(buttonClass.includes("activity-filter-label"), false);
  });
});
