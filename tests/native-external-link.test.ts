import test from "node:test";
import assert from "node:assert/strict";

import { classifyExternalLink } from "../client/src/lib/nativeExternalLink";

const WEBVIEW = "https://localhost";

test("same-origin in-app navigations are left to the WebView and wouter", () => {
  assert.deepEqual(classifyExternalLink("/terms", { currentOrigin: WEBVIEW }), {
    kind: "passthrough",
  });
  assert.deepEqual(classifyExternalLink("/privacy", { currentOrigin: WEBVIEW }), {
    kind: "passthrough",
  });
  assert.deepEqual(
    classifyExternalLink("/person/abc?ref=VX1#comment-2", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
  assert.deepEqual(
    classifyExternalLink("https://localhost/vote", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
  assert.deepEqual(classifyExternalLink("#leaderboard", { currentOrigin: WEBVIEW }), {
    kind: "passthrough",
  });
  assert.deepEqual(classifyExternalLink("", { currentOrigin: WEBVIEW }), {
    kind: "passthrough",
  });
});

test("target=_blank first-party links stay in the SPA instead of a dropped window", () => {
  assert.deepEqual(
    classifyExternalLink("/terms", { currentOrigin: WEBVIEW, target: "_blank" }),
    { kind: "in_app", path: "/terms" },
  );
  assert.deepEqual(
    classifyExternalLink("/privacy", { currentOrigin: WEBVIEW, target: "_blank" }),
    { kind: "in_app", path: "/privacy" },
  );
  assert.deepEqual(
    classifyExternalLink("https://localhost/login/welcome", {
      currentOrigin: WEBVIEW,
      target: "_blank",
    }),
    { kind: "in_app", path: "/login/welcome" },
  );
  assert.deepEqual(
    classifyExternalLink("#section", {
      currentOrigin: WEBVIEW,
      baseHref: "https://localhost/person/abc",
      target: "_blank",
    }),
    { kind: "in_app", path: "/person/abc#section" },
  );
});

test("public voxdex.com links stay in-app, including www and query/hash", () => {
  assert.deepEqual(
    classifyExternalLink(
      "https://voxdex.com/person/abc?ref=VXABCDEF&sharer=user-1#comment-9",
      { currentOrigin: WEBVIEW },
    ),
    {
      kind: "in_app",
      path: "/person/abc?ref=VXABCDEF&sharer=user-1#comment-9",
    },
  );
  assert.deepEqual(
    classifyExternalLink("https://www.voxdex.com/terms", { currentOrigin: WEBVIEW }),
    { kind: "in_app", path: "/terms" },
  );
  assert.deepEqual(
    classifyExternalLink("https://WWW.voxdex.com/privacy", { currentOrigin: WEBVIEW }),
    { kind: "in_app", path: "/privacy" },
  );
  assert.deepEqual(
    classifyExternalLink("https://voxdex.com/terms", {
      currentOrigin: "https://voxdex.com",
    }),
    { kind: "passthrough" },
  );
  assert.deepEqual(
    classifyExternalLink("https://www.voxdex.com/privacy", {
      currentOrigin: "https://voxdex.com",
      target: "_blank",
    }),
    { kind: "in_app", path: "/privacy" },
  );
});

test("other webview origins are rewritten into the bundled SPA", () => {
  assert.deepEqual(
    classifyExternalLink("http://localhost/predict", { currentOrigin: WEBVIEW }),
    { kind: "in_app", path: "/predict" },
  );
  assert.deepEqual(
    classifyExternalLink("capacitor://localhost/markets/world", { currentOrigin: WEBVIEW }),
    { kind: "in_app", path: "/markets/world" },
  );
});

test("third-party https links open externally, with or without target=_blank", () => {
  const cases = [
    ["https://x.com/someuser", "https://x.com/someuser"],
    ["https://instagram.com/someuser", "https://instagram.com/someuser"],
    ["https://en.wikipedia.org/wiki/Ada_Lovelace", "https://en.wikipedia.org/wiki/Ada_Lovelace"],
    ["https://ico.org.uk", "https://ico.org.uk/"],
    ["https://inforegulator.org.za", "https://inforegulator.org.za/"],
    ["https://polymarket.com/event/example", "https://polymarket.com/event/example"],
    [
      "https://abcdefgh.supabase.co/auth/v1/authorize?provider=google",
      "https://abcdefgh.supabase.co/auth/v1/authorize?provider=google",
    ],
    [
      "https://accounts.google.com/o/oauth2/v2/auth",
      "https://accounts.google.com/o/oauth2/v2/auth",
    ],
  ] as const;
  for (const [input, url] of cases) {
    assert.deepEqual(classifyExternalLink(input, { currentOrigin: WEBVIEW }), {
      kind: "external",
      url,
    });
    assert.deepEqual(
      classifyExternalLink(input, { currentOrigin: WEBVIEW, target: "_blank" }),
      { kind: "external", url },
    );
  }
  assert.deepEqual(
    classifyExternalLink("//evil.example/phish", { currentOrigin: WEBVIEW }),
    { kind: "external", url: "https://evil.example/phish" },
  );
  assert.deepEqual(
    classifyExternalLink("http://voxdex.com/terms", { currentOrigin: WEBVIEW }),
    { kind: "external", url: "http://voxdex.com/terms" },
  );
  assert.deepEqual(
    classifyExternalLink("https://voxdex.com.evil.com/terms", { currentOrigin: WEBVIEW }),
    { kind: "external", url: "https://voxdex.com.evil.com/terms" },
  );
  assert.deepEqual(
    classifyExternalLink("https://voxdex.com:444/terms", { currentOrigin: WEBVIEW }),
    { kind: "external", url: "https://voxdex.com:444/terms" },
  );
});

test("window.open is a new context even without target=_blank", () => {
  assert.deepEqual(
    classifyExternalLink("/logo-download.html", {
      currentOrigin: WEBVIEW,
      newContext: true,
    }),
    { kind: "in_app", path: "/logo-download.html" },
  );
  assert.deepEqual(
    classifyExternalLink("https://example.com/article", {
      currentOrigin: WEBVIEW,
      newContext: true,
    }),
    { kind: "external", url: "https://example.com/article" },
  );
});

test("mailto, tel, sms, and market stay on the OS intent path", () => {
  assert.deepEqual(
    classifyExternalLink("mailto:legal@voxdex.com", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
  assert.deepEqual(
    classifyExternalLink("mailto:legal@voxdex.com", {
      currentOrigin: WEBVIEW,
      target: "_blank",
    }),
    { kind: "system", url: "mailto:legal@voxdex.com" },
  );
  assert.deepEqual(classifyExternalLink("tel:+27111234567", { currentOrigin: WEBVIEW }), {
    kind: "passthrough",
  });
  assert.deepEqual(
    classifyExternalLink("sms:+27111234567", { currentOrigin: WEBVIEW, target: "_blank" }),
    { kind: "system", url: "sms:+27111234567" },
  );
  assert.deepEqual(
    classifyExternalLink("market://details?id=com.voxdex.app", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
});

test("intent and file URLs are blocked; the OAuth custom scheme is not opened as the web", () => {
  assert.deepEqual(
    classifyExternalLink(
      "intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end",
      { currentOrigin: WEBVIEW },
    ),
    { kind: "block" },
  );
  assert.deepEqual(classifyExternalLink("file:///sdcard/secret.txt", { currentOrigin: WEBVIEW }), {
    kind: "block",
  });
  assert.deepEqual(
    classifyExternalLink("com.voxdex.app://login?code=pkce-code", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
  assert.deepEqual(
    classifyExternalLink("com.voxdex.app://login?code=pkce-code", {
      currentOrigin: WEBVIEW,
      target: "_blank",
      newContext: true,
    }),
    { kind: "passthrough" },
  );
  assert.deepEqual(
    classifyExternalLink("javascript:void(0)", { currentOrigin: WEBVIEW }),
    { kind: "passthrough" },
  );
});

test("credentialed and lookalike first-party URLs do not navigate in-app", () => {
  assert.deepEqual(
    classifyExternalLink("https://user:pass@voxdex.com/terms", { currentOrigin: WEBVIEW }),
    { kind: "block" },
  );
  assert.deepEqual(
    classifyExternalLink("https://voxdex.com@evil.example/terms", { currentOrigin: WEBVIEW }),
    { kind: "block" },
  );
});
