import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IOS_INPUT_MIN_FONT_PX,
  IOS_KEYBOARD_ACCESSORY_VISIBLE,
  IOS_KEYBOARD_BACKDROP,
  IOS_KEYBOARD_RESIZE,
  shouldInstallIosKeyboard,
  viewportAllowsUserZoom,
} from "../client/src/lib/iosKeyboard";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("the iOS keyboard helper is installed only on the native iOS shell", () => {
  assert.equal(shouldInstallIosKeyboard(true, "ios"), true);
  assert.equal(shouldInstallIosKeyboard(true, "android"), false);
  assert.equal(shouldInstallIosKeyboard(false, "ios"), false);
  assert.equal(shouldInstallIosKeyboard(false, "web"), false);
  assert.equal(IOS_KEYBOARD_RESIZE, "native");
  assert.equal(IOS_KEYBOARD_BACKDROP, "dom");
  assert.equal(IOS_KEYBOARD_ACCESSORY_VISIBLE, true);
  assert.equal(IOS_INPUT_MIN_FONT_PX, 16);
});

test("capacitor keyboard config resizes iOS and does not enable the Android fullscreen workaround", () => {
  const config = read("capacitor.config.ts");
  assert.match(config, /Keyboard:\s*\{[^}]*resize:\s*"native"/s);
  assert.match(config, /autoBackdropColor:\s*"dom"/);
  assert.equal(/resizeOnFullScreen\s*:/.test(config), false);
  assert.match(config, /insetsHandling:\s*"css"/);

  const pkg = read("package.json");
  assert.match(pkg, /"@capacitor\/keyboard":\s*"\^8\./);
});

test("iOS shell fields are at least 16px and the viewport still allows pinch zoom", () => {
  const css = read("client/src/index.css");
  const rule = css.slice(css.indexOf("html.ios-shell input,"));
  assert.match(rule, /html\.ios-shell textarea/);
  assert.match(rule, /html\.ios-shell select/);
  assert.match(rule.slice(0, rule.indexOf("}")), /font-size:\s*16px/);
  assert.equal(css.includes("html.ios-shell,"), false);

  const viewport = /<meta name="viewport" content="([^"]+)"/.exec(read("client/index.html"));
  assert.ok(viewport);
  assert.equal(viewportAllowsUserZoom(viewport?.[1] ?? ""), true);
  assert.equal(viewportAllowsUserZoom("width=device-width, maximum-scale=1"), false);
  assert.equal(viewportAllowsUserZoom("width=device-width, user-scalable=no"), false);
  assert.equal(viewportAllowsUserZoom("width=device-width"), false);
});
