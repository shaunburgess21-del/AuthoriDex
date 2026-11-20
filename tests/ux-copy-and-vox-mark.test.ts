import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { GLOSSARY, glossarySentence } from "../client/src/lib/glossary";
import { categoryRankLabel, neutralShareLabel, overallRankLabel } from "../client/src/lib/profile-rank-label";
import { isStablePress, STABLE_PRESS_SLOP_PX } from "../client/src/lib/stable-press";
import { splitVoxText, textHasVoxMark } from "../client/src/lib/vox-text";

const root = new URL("../client/src", import.meta.url);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("glossary sentences are one line each and cover the requested terms", () => {
  const keys = [
    "trendScore",
    "xp",
    "vox",
    "pnl",
    "shares",
    "h2h",
    "inductionQueue",
    "curateProfile",
    "approval",
    "wikiSignal",
    "newsSignal",
    "categoryRank",
    "overallRank",
    "neutralShare",
  ] as const;
  for (const key of keys) {
    const sentence = glossarySentence(key);
    assert.equal(sentence, GLOSSARY[key]);
    assert.equal(sentence.includes("\n"), false, key);
    assert.match(sentence, /\.$/, key);
    assert.ok(sentence.length < 180, key);
  }
  assert.match(GLOSSARY.vox, /no cash value/i);
  assert.equal(/\$|cash out|withdraw/i.test(GLOSSARY.vox) && /real money|redeem/i.test(GLOSSARY.vox), false);
});

test("profile rank labels name the category and overall list", () => {
  assert.equal(categoryRankLabel("Music", 2), "Music #2");
  assert.equal(categoryRankLabel("  ", 2), "Category #2");
  assert.equal(overallRankLabel(6), "Overall #6");
  assert.equal(overallRankLabel(null), "Overall New");
  assert.equal(neutralShareLabel(1), "Neutral 1%");
  assert.equal(neutralShareLabel(1.4), "Neutral 1%");
});

test("a short pointer move still counts as a tap, a drag does not", () => {
  const start = { x: 10, y: 20 };
  assert.equal(isStablePress(start, { x: 12, y: 22 }), true);
  assert.equal(isStablePress(start, { x: 10 + STABLE_PRESS_SLOP_PX + 4, y: 20 }), false);
  assert.equal(isStablePress(null, start), false);
});

test("Vox text splits the brand glyph and the won-sign fallback into a mark", () => {
  const parts = splitVoxText("+\uA75E13.41 and \u20A95");
  assert.deepEqual(parts, [
    { type: "text", value: "+" },
    { type: "mark" },
    { type: "text", value: "13.41 and " },
    { type: "mark" },
    { type: "text", value: "5" },
  ]);
  assert.equal(textHasVoxMark("9,510 Vox"), false);
  assert.equal(textHasVoxMark("\uA75E100"), true);
});

test("the Vox mark is an inline SVG with one bar, not a won-sign double stroke", () => {
  const source = readFileSync(new URL("../client/src/components/VoxMark.tsx", import.meta.url), "utf8");
  assert.match(source, /<svg/);
  assert.match(source, /currentColor/);
  assert.equal(source.includes("http"), false);
  assert.equal(source.includes("<img"), false);
  assert.match(source, /h-\[0\.9em\]/);
  assert.equal(source.includes("stroke="), false);
  const bars = source.match(/H[\d.]+V[\d.]+H[\d.]+/g) ?? [];
  assert.equal(bars.length, 1);
});

test("client UI source does not paint the raw Vox glyph or a won sign", () => {
  const allow = new Set([
    "lib/vox-text.ts",
    "components/VoxMark.tsx",
    // String data rendered through <VoxText>, so the glyph never paints.
    "components/StakeModal.tsx",
    "components/predict/RulesContent.tsx",
    "components/rulesStepData.tsx",
  ]);
  const offenders: string[] = [];
  for (const file of walk(root.pathname)) {
    const rel = relative(root.pathname, file);
    if (allow.has(rel)) continue;
    const stripped = stripComments(readFileSync(file, "utf8"));
    if (stripped.includes("\uA75E") || stripped.includes("\uA75F") || stripped.includes("\u20A9")) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});
