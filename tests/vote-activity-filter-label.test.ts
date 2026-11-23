import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("vote activity filter label", () => {
  const source = readFileSync(
    new URL("../client/src/components/VoteActivityFilterFab.tsx", import.meta.url),
    "utf8",
  );
  const quickVote = readFileSync(
    new URL("../client/src/components/quick-vote/QuickVoteHost.tsx", import.meta.url),
    "utf8",
  );

  it("expands the state label inside the pill, matching the Quick Vote slide-out", () => {
    assert.equal(source.includes("absolute bottom-[calc(100%+8px)]"), false);
    assert.equal(source.includes("mb-2 whitespace-nowrap rounded-full"), false);

    const buttonAt = source.indexOf("<motion.button");
    const labelAt = source.indexOf("data-testid={`${testId}-label`}");
    const buttonEnd = source.indexOf("</motion.button>");
    assert.ok(buttonAt > 0 && labelAt > buttonAt && buttonEnd > labelAt);

    const pillOpen = '{ width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }';
    const pillClosed = "{ width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }";
    assert.equal(quickVote.includes(pillOpen), true);
    assert.equal(quickVote.includes(pillClosed), true);
    assert.equal(source.includes(pillOpen), true);
    assert.equal(source.includes(pillClosed), true);
    assert.match(source, /duration: labelVisible \? 0\.2 : 0\.45, ease: "easeOut"/);
    assert.match(source, /className="pointer-events-auto relative flex flex-col items-end"/);
  });

  it("keeps a fixed-width count through 999 and pulses only when it drops", () => {
    assert.equal(source.includes("99+"), false);
    assert.match(source, /formatActivityFilterCount/);
    assert.match(source, /min-w-\[2\.5rem\]/);
    assert.match(source, /tabular-nums/);
    assert.match(source, /count < previous\.current && !prefersReducedMotion\(\)/);
    assert.match(source, /activity-count-drop/);
    const css = readFileSync(new URL("../client/src/index.css", import.meta.url), "utf8");
    assert.match(css, /@keyframes activity-count-drop/);
    assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.activity-count-drop \{\s*animation: none;/);
  });

  it("keeps the state in the button name and a polite live announcement", () => {
    assert.match(
      source,
      /aria-label=\{hubActivityFilterFabAriaLabel\(scope, value, count, ownedCount\)\}/,
    );
    assert.match(source, /role="status"/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /aria-atomic="true"/);
    assert.match(source, /data-testid=\{`\$\{testId\}-live`\}/);
    const labelTag = source.slice(
      source.lastIndexOf("<motion.span"),
      source.indexOf("</motion.span>"),
    );
    assert.match(labelTag, /aria-hidden/);
  });
});
