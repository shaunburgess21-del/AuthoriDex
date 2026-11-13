import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "client/src/index.css"), "utf8");

test("the iOS shell paints the theme behind rubber-band and kills the tap flash", () => {
  const chrome = css.slice(css.lastIndexOf("html.ios-shell {"));
  assert.match(chrome, /background-color:\s*hsl\(var\(--background\)\)/);
  assert.match(chrome, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(css, /html\.ios-shell body\s*\{[^}]*background-color:\s*hsl\(var\(--background\)\)/);
  assert.match(css, /html\.ios-shell \*\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/);
  assert.match(css, /html\.ios-shell body\s*\{[^}]*min-height:\s*100%/);
});

test("buttons, nav, and cards cannot be selected, and images and links lose the callout", () => {
  const chrome = css.slice(css.indexOf("html.ios-shell button,"), css.indexOf("html.ios-shell a,"));
  for (const selector of [
    "html.ios-shell nav",
    "html.ios-shell [role=\"button\"]",
    "html.ios-shell [role=\"tab\"]",
    "html.ios-shell .lb-row-card",
    "html.ios-shell .hub-card-hover",
  ]) {
    assert.equal(chrome.includes(selector), true, selector);
  }
  assert.match(chrome, /-webkit-user-select:\s*none/);
  assert.match(chrome, /user-select:\s*none/);
  assert.match(chrome, /-webkit-touch-callout:\s*none/);
  assert.match(css, /html\.ios-shell a,\s*html\.ios-shell img\s*\{[^}]*-webkit-touch-callout:\s*none/);
  assert.match(css, /html\.ios-shell img\s*\{[^}]*-webkit-user-select:\s*none/);
});

test("fields and prose keep text selection, and the shell class is not grouped onto website html", () => {
  const prose = css.slice(css.indexOf("html.ios-shell input,"));
  for (const selector of [
    "html.ios-shell textarea",
    "html.ios-shell select",
    "html.ios-shell [contenteditable=\"true\"]",
    "html.ios-shell p",
    "html.ios-shell li",
    "html.ios-shell blockquote",
  ]) {
    assert.equal(prose.includes(selector), true, selector);
  }
  assert.match(prose, /-webkit-user-select:\s*text/);
  assert.match(prose, /user-select:\s*text/);
  assert.equal(css.includes("html.ios-shell,"), false);
});
