import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "client/src/index.css"), "utf8");

function elevationBlock(): string {
  const start = css.indexOf("/* ===== HUB CARD ELEVATION =====");
  const end = css.indexOf("/* ===== JACKPOT HERO BACKGROUND =====");
  assert.ok(start > 0 && end > start, "hub card elevation block is present");
  return css.slice(start, end);
}

test("hub card float tokens beat per-card utility backgrounds", () => {
  const utilitiesClose = css.lastIndexOf("\n}\n\n/* ===== HUB CARD ELEVATION =====");
  assert.ok(utilitiesClose > 0, "elevation block sits after the utilities layer");
  const block = elevationBlock();
  assert.match(block, /\.dark \{\s*--hub-card-surface:\s*hsl\(220 22% 11\.5%\)/);
  assert.match(block, /--hub-card-border:\s*rgba\(255, 255, 255, 0\.06\)/);
  assert.match(block, /inset 0 1px 0 rgba\(255, 255, 255, 0\.07\)/);
  assert.match(block, /html \.hub-card-hover\.lb-row-neutral \{\s*background-color:\s*var\(--hub-card-surface\)/);
  assert.match(block, /backdrop-filter:\s*none/);
  assert.equal(block.includes("backdrop-filter: blur"), false);
});

test("desktop hover lifts 2px and touch pointers do not transform", () => {
  const block = elevationBlock();
  const hover = block.slice(block.indexOf("@media (hover: hover) and (pointer: fine)"));
  assert.match(hover, /html \.hub-card-hover\.lb-row-neutral:hover \{\s*transform:\s*translateY\(-2px\)/);
  assert.equal(hover.includes("scale("), false);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\s*html \.hub-card-hover\.lb-row-neutral:hover \{\s*transform:\s*none/);

  const layeredHover = css.slice(
    css.indexOf("Lip + wash only."),
    css.indexOf(".hub-card-hover.hub-card-selected::before"),
  );
  assert.match(layeredHover, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.equal(layeredHover.includes("translateY"), false);
  assert.equal(layeredHover.includes("scale("), false);
});

test("ambient shadow blur stays modest", () => {
  const block = elevationBlock();
  const blurs = [...block.matchAll(/(\d+)px/g)].map((match) => Number(match[1]));
  const widest = Math.max(...blurs);
  assert.ok(widest <= 28, `blur/offset ${widest}px exceeds 28px`);
});
