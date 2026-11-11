import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SystemBarsStyle } from "@capacitor/core";

import {
  IOS_SAFE_AREA_INSET_EDGES,
  IOS_SHELL_CLASS,
  applyIosSafeAreaShellClass,
  iosSafeAreaInsetDeclaration,
  platformSyncsSystemBarStyle,
  shouldApplyIosSafeAreaShell,
  systemBarsStyleForTheme,
} from "../client/src/lib/nativeSystemBars";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function recordingClassList(): { tokens: string[]; add(token: string): void } {
  const tokens: string[] = [];
  return {
    tokens,
    add(token: string) {
      if (!tokens.includes(token)) tokens.push(token);
    },
  };
}

test("dark theme asks for light status-bar glyphs and light theme asks for dark glyphs", () => {
  assert.equal(systemBarsStyleForTheme("dark"), SystemBarsStyle.Dark);
  assert.equal(systemBarsStyleForTheme("dark"), "DARK");
  assert.equal(systemBarsStyleForTheme("light"), SystemBarsStyle.Light);
  assert.equal(systemBarsStyleForTheme("light"), "LIGHT");
});

test("status-bar style sync runs on the Android and iOS shells only", () => {
  assert.equal(platformSyncsSystemBarStyle("android"), true);
  assert.equal(platformSyncsSystemBarStyle("ios"), true);
  assert.equal(platformSyncsSystemBarStyle("web"), false);
  assert.equal(platformSyncsSystemBarStyle("iOS"), false);
  assert.equal(platformSyncsSystemBarStyle(""), false);
});

test("the safe-area shell class is added only for the native iOS shell", () => {
  assert.equal(IOS_SHELL_CLASS, "ios-shell");
  assert.equal(shouldApplyIosSafeAreaShell("ios", true), true);
  assert.equal(shouldApplyIosSafeAreaShell("ios", false), false);
  assert.equal(shouldApplyIosSafeAreaShell("android", true), false);
  assert.equal(shouldApplyIosSafeAreaShell("android", false), false);
  assert.equal(shouldApplyIosSafeAreaShell("web", true), false);
  assert.equal(shouldApplyIosSafeAreaShell("web", false), false);

  const ios = recordingClassList();
  assert.equal(applyIosSafeAreaShellClass({ classList: ios }, "ios", true), true);
  assert.deepEqual(ios.tokens, ["ios-shell"]);
  applyIosSafeAreaShellClass({ classList: ios }, "ios", true);
  assert.deepEqual(ios.tokens, ["ios-shell"]);

  for (const [platform, native] of [
    ["ios", false],
    ["android", true],
    ["web", false],
    ["web", true],
  ] as const) {
    const list = recordingClassList();
    assert.equal(applyIosSafeAreaShellClass({ classList: list }, platform, native), false);
    assert.deepEqual(list.tokens, []);
  }
});

test("html.ios-shell maps every safe-area variable to the live env() inset", () => {
  const css = read("client/src/index.css");
  const block = /html\.ios-shell\s*\{([^}]*)\}/.exec(css);
  assert.ok(block, "expected an html.ios-shell rule");
  const body = block[1] ?? "";

  assert.deepEqual([...IOS_SAFE_AREA_INSET_EDGES], ["top", "right", "bottom", "left"]);
  for (const edge of IOS_SAFE_AREA_INSET_EDGES) {
    const declaration = iosSafeAreaInsetDeclaration(edge);
    assert.equal(body.includes(declaration), true, declaration);
    assert.equal(css.split(declaration).length - 1, 1, `${declaration} should appear once`);
  }

  assert.equal(css.includes("html.ios-shell,"), false);
  assert.equal(/^\s*html\s*\{[^}]*--safe-area-inset-/m.test(css), false);
  assert.equal(read("client/index.html").includes("ios-shell"), false);
});

test("startup and theme toggle use the shared native sync and leave Android insetsHandling on css", () => {
  const bars = read("client/src/lib/nativeSystemBars.ts");
  assert.match(bars, /platformSyncsSystemBarStyle\(platform\)/);
  assert.match(bars, /applyIosSafeAreaShellClass\(/);
  assert.match(
    bars,
    /SystemBars\.setStyle\(\{\s*style: systemBarsStyleForTheme\(theme\),\s*\}\)/,
  );
  assert.equal(bars.includes("bar:"), false);

  const main = read("client/src/main.tsx");
  assert.match(main, /syncNativeSystemBars\(localStorage\.getItem\("theme"\) === "light" \? "light" : "dark"\)/);
  assert.match(main, /syncNativeSystemBars\("dark"\)/);
  assert.equal(main.includes("syncAndroidSystemBars"), false);

  const theme = read("client/src/hooks/useThemeToggle.ts");
  assert.match(theme, /syncNativeSystemBars\(theme\)/);
  assert.equal(theme.includes("syncAndroidSystemBars"), false);

  const config = read("capacitor.config.ts");
  assert.match(config, /insetsHandling:\s*"css"/);
});
