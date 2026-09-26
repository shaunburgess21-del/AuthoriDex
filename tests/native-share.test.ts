import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_SHARE_ORIGIN,
  androidShareFields,
  fileUriForShare,
  isShareCancelled,
  shareLinkOrigin,
  toPublicShareText,
  toPublicShareUrl,
  type ShareUrlContext,
} from "../client/src/lib/nativeShare";

const androidLocalhost: ShareUrlContext = {
  nativeAndroid: true,
  currentOrigin: "https://localhost",
};

const webProduction: ShareUrlContext = {
  nativeAndroid: false,
  currentOrigin: "https://voxdex.com",
};

const webLocalhost: ShareUrlContext = {
  nativeAndroid: false,
  currentOrigin: "http://localhost",
};

test("android rewrites webview share URLs to https://voxdex.com and keeps query and hash", () => {
  const cases: Array<[string, string, string]> = [
    [
      "https://localhost",
      "https://localhost/person/abc?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile#comment-9",
      "https://voxdex.com/person/abc?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile#comment-9",
    ],
    [
      "http://localhost",
      "http://localhost/?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=referral",
      "https://voxdex.com/?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=referral",
    ],
    [
      "capacitor://localhost",
      "capacitor://localhost/markets/world-event?sharer=user-1&utm_campaign=market#top",
      "https://voxdex.com/markets/world-event?sharer=user-1&utm_campaign=market#top",
    ],
    [
      "https://localhost",
      "https://localhost/?category=sports&search=ada&sortDir=asc#leaderboard",
      "https://voxdex.com/?category=sports&search=ada&sortDir=asc#leaderboard",
    ],
    [
      "https://localhost",
      "https://localhost/share/bet/bet_123?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=prediction_win",
      "https://voxdex.com/share/bet/bet_123?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=prediction_win",
    ],
  ];

  for (const [currentOrigin, input, expected] of cases) {
    assert.equal(
      toPublicShareUrl(input, { nativeAndroid: true, currentOrigin }),
      expected,
    );
  }
  assert.equal(PUBLIC_SHARE_ORIGIN, "https://voxdex.com");
});

test("web, iOS, and already-public URLs are not rewritten", () => {
  const publicUrl =
    "https://voxdex.com/person/abc?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile";
  assert.equal(toPublicShareUrl(publicUrl, webProduction), publicUrl);
  assert.equal(
    toPublicShareUrl("http://localhost/person/abc?sharer=user-1", webLocalhost),
    "http://localhost/person/abc?sharer=user-1",
  );
  assert.equal(
    toPublicShareUrl(publicUrl, androidLocalhost),
    publicUrl,
  );
  assert.equal(
    toPublicShareUrl("https://localhost/person/abc?sharer=1", {
      nativeAndroid: true,
      currentOrigin: "https://voxdex.com",
    }),
    "https://localhost/person/abc?sharer=1",
  );
});

test("android does not rewrite other hosts, ports, or userinfo", () => {
  const blocked = [
    "https://localhost.evil.com/person/abc?sharer=1",
    "https://voxdex.com.evil.com/person/abc",
    "https://localhost:8443/person/abc?ref=VXABCDEF",
    "https://user:pass@localhost/person/abc",
    "https://example.com/person/abc?utm_source=voxdex",
  ];
  for (const url of blocked) {
    assert.equal(toPublicShareUrl(url, androidLocalhost), url);
  }
});

test("share text rewrites embedded webview links and leaves the sentence", () => {
  const input =
    'I just backed Up on "Ada" on VoxDex!\nhttps://localhost/share/bet/bet_123?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=prediction_win';
  assert.equal(
    toPublicShareText(input, androidLocalhost),
    'I just backed Up on "Ada" on VoxDex!\nhttps://voxdex.com/share/bet/bet_123?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=prediction_win',
  );
  assert.equal(
    toPublicShareText("see https://localhost.evil.com/phish", androidLocalhost),
    "see https://localhost.evil.com/phish",
  );
  assert.equal(toPublicShareText(input, webProduction), input);
  assert.equal(toPublicShareText(input, webLocalhost), input);
});

test("referral origin is public only on android webview", () => {
  assert.equal(shareLinkOrigin("https://localhost", true), "https://voxdex.com");
  assert.equal(shareLinkOrigin("capacitor://localhost", true), "https://voxdex.com");
  assert.equal(shareLinkOrigin("https://voxdex.com", true), "https://voxdex.com");
  assert.equal(shareLinkOrigin("https://localhost", false), "https://localhost");
  assert.equal(shareLinkOrigin("https://voxdex.com", false), "https://voxdex.com");
});

test("android share fields omit url when the text already contains it", () => {
  const url = "https://voxdex.com/markets/world-event?sharer=user-1&utm_campaign=market";
  assert.deepEqual(
    androidShareFields({
      title: "VoxDex",
      text: `I just backed Yes on "World" on VoxDex!\n${url}`,
      url,
    }),
    {
      title: "VoxDex",
      text: `I just backed Yes on "World" on VoxDex!\n${url}`,
    },
  );
  assert.deepEqual(
    androidShareFields({
      title: "VoxDex Insights — Discover",
      text: "Crowd vs data stories on VoxDex",
      url: "https://voxdex.com/insights?tab=discover",
    }),
    {
      title: "VoxDex Insights — Discover",
      text: "Crowd vs data stories on VoxDex",
      url: "https://voxdex.com/insights?tab=discover",
    },
  );
});

test("file URIs accepted by the share plugin are normalized", () => {
  assert.equal(fileUriForShare("file:///data/cache/share/card.png"), "file:///data/cache/share/card.png");
  assert.equal(fileUriForShare("/data/cache/share/card.png"), "file:///data/cache/share/card.png");
  assert.equal(fileUriForShare("content://com.voxdex.app.fileprovider/cache/card.png"), null);
  assert.equal(fileUriForShare("https://voxdex.com/card.png"), null);
});

test("share cancel is not treated as a failed share", () => {
  const abort = new Error("AbortError");
  abort.name = "AbortError";
  assert.equal(isShareCancelled(abort), true);
  assert.equal(isShareCancelled(new Error("Share canceled")), true);
  assert.equal(isShareCancelled({ message: "Share cancelled" }), true);
  assert.equal(isShareCancelled("Share canceled"), true);
  assert.equal(isShareCancelled(new Error("Must provide a URL or Message or files")), false);
  assert.equal(isShareCancelled({ message: "Can't share while sharing is in progress" }), false);
});
