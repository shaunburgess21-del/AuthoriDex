import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  NATIVE_OAUTH_CALLBACK_SCHEME,
  NATIVE_OAUTH_REDIRECT,
  isNativeOAuthUserCancel,
  nativeOAuthLaunchForPlatform,
} from "../client/src/lib/nativeOAuthLaunch";

test("iOS uses the system auth session and the shared custom-scheme redirect", () => {
  const launch = nativeOAuthLaunchForPlatform("ios", "capacitor://localhost");
  assert.equal(launch.kind, "as-web-authentication-session");
  assert.equal(launch.redirectTo, NATIVE_OAUTH_REDIRECT);
  assert.equal(launch.redirectTo, "com.voxdex.app://login");
  assert.equal(launch.skipBrowserRedirect, true);
  if (launch.kind !== "as-web-authentication-session") return;
  assert.equal(launch.callbackScheme, NATIVE_OAUTH_CALLBACK_SCHEME);
  assert.equal(launch.callbackScheme, "com.voxdex.app");
  assert.equal(launch.callbackScheme.includes("://"), false);
});

test("Android keeps the system browser and the same redirect as iOS", () => {
  const ios = nativeOAuthLaunchForPlatform("ios", "https://localhost");
  const android = nativeOAuthLaunchForPlatform("android", "https://localhost");
  assert.equal(android.kind, "system-browser");
  assert.equal(android.redirectTo, ios.redirectTo);
  assert.equal(android.skipBrowserRedirect, true);
  assert.equal("callbackScheme" in android, false);
});

test("web sign-in stays a same-tab redirect to this origin", () => {
  const launch = nativeOAuthLaunchForPlatform("web", "https://voxdex.com");
  assert.deepEqual(launch, {
    kind: "web-redirect",
    redirectTo: "https://voxdex.com/login",
    skipBrowserRedirect: false,
  });
});

test("only the exact ios platform selects the auth session", () => {
  for (const platform of ["iOS", "IOS", "android", "web", ""]) {
    assert.notEqual(
      nativeOAuthLaunchForPlatform(platform, "https://voxdex.com").kind,
      "as-web-authentication-session",
    );
  }
});

test("system-sheet cancel is not a sign-in failure", () => {
  assert.equal(isNativeOAuthUserCancel({ code: "cancelled", message: "The user cancelled sign-in." }), true);
  assert.equal(isNativeOAuthUserCancel({ code: "canceled" }), true);
  assert.equal(
    isNativeOAuthUserCancel({
      message: "The operation couldn’t be completed. (com.apple.AuthenticationServices.WebAuthenticationSession error 1.)",
    }),
    true,
  );
  assert.equal(isNativeOAuthUserCancel({ code: "start_failed", message: "Could not start the sign-in sheet." }), false);
  assert.equal(isNativeOAuthUserCancel({ code: "access_denied", message: "Access denied" }), false);
  assert.equal(isNativeOAuthUserCancel("cancelled"), false);
  assert.equal(isNativeOAuthUserCancel(null), false);
});

test("Info.plist registers the com.voxdex.app callback scheme", () => {
  const plist = readFileSync(new URL("../ios/App/App/Info.plist", import.meta.url), "utf8");
  assert.match(plist, /<key>CFBundleURLSchemes<\/key>[\s\S]*<string>com\.voxdex\.app<\/string>/);
});

test("iOS shell registers ASWebAuthenticationSession and not SFSafariViewController", () => {
  const plugin = readFileSync(new URL("../ios/App/App/AsWebAuthPlugin.swift", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("../ios/App/App/VoxDexBridgeViewController.swift", import.meta.url), "utf8");
  const scene = readFileSync(new URL("../ios/App/App/SceneDelegate.swift", import.meta.url), "utf8");
  const project = readFileSync(new URL("../ios/App/App.xcodeproj/project.pbxproj", import.meta.url), "utf8");

  assert.match(plugin, /ASWebAuthenticationSession/);
  assert.match(plugin, /callbackURLScheme/);
  assert.doesNotMatch(plugin, /SFSafariViewController/);
  assert.match(bridge, /registerPluginInstance\(AsWebAuthPlugin\(\)\)/);
  assert.match(scene, /VoxDexBridgeViewController\(\)/);
  assert.match(project, /AsWebAuthPlugin\.swift/);
  assert.match(project, /VoxDexBridgeViewController\.swift/);
});
