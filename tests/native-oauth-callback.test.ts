import test from "node:test";
import assert from "node:assert/strict";

import { parseNativeOAuthCallback } from "../client/src/lib/nativeOAuthCallback";

test("PKCE return yields the code only, not the custom-scheme URL", () => {
  const parsed = parseNativeOAuthCallback(
    "com.voxdex.app://login?code=auth-code-1&state=xyz",
  );
  assert.deepEqual(parsed, { status: "code", code: "auth-code-1" });
});

test("trailing-slash host still yields the code", () => {
  const parsed = parseNativeOAuthCallback("com.voxdex.app://login/?code=auth-code-2");
  assert.deepEqual(parsed, { status: "code", code: "auth-code-2" });
});

test("provider error query is returned as a message", () => {
  const parsed = parseNativeOAuthCallback(
    "com.voxdex.app://login?error=access_denied&error_description=User%20cancelled",
  );
  assert.deepEqual(parsed, { status: "error", message: "User cancelled" });
});

test("implicit hash tokens are not treated as a PKCE code", () => {
  const parsed = parseNativeOAuthCallback(
    "com.voxdex.app://login#access_token=token&refresh_token=refresh",
  );
  assert.equal(parsed.status, "error");
  assert.equal("code" in parsed, false);
});

test("web and other-host URLs are ignored", () => {
  assert.equal(
    parseNativeOAuthCallback("https://voxdex.com/login?code=abc").status,
    "ignore",
  );
  assert.equal(
    parseNativeOAuthCallback("https://voxdex.com/login#access_token=t").status,
    "ignore",
  );
  assert.equal(
    parseNativeOAuthCallback("com.voxdex.app://other?code=abc").status,
    "ignore",
  );
});
