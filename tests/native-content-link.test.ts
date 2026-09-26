import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { contentPathFromUrl } from "../client/src/lib/nativeContentLink";

const CLOUD_AGENT_DEBUG_SHA256 =
  "FB:D1:60:0F:BE:6C:9F:1B:79:14:C0:AE:EF:05:01:E4:7C:D2:44:3B:E4:D0:E4:B1:8E:29:18:5C:A3:34:EA:18";
const PIXEL_DEBUG_SHA256 =
  "13:A5:1F:E3:5A:45:BD:9C:D2:46:DA:95:EB:BB:32:E4:ED:B6:26:88:AC:D5:B5:55:B7:E0:6E:9C:29:44:07:7D";

test("OAuth custom scheme is ignored by the content router", () => {
  assert.deepEqual(
    contentPathFromUrl("com.voxdex.app://login?code=auth-code-1&state=xyz"),
    { status: "ignore" },
  );
  assert.deepEqual(
    contentPathFromUrl("com.voxdex.app://login/?code=auth-code-2"),
    { status: "ignore" },
  );
  assert.deepEqual(
    contentPathFromUrl(
      "com.voxdex.app://login?error=access_denied&error_description=User%20cancelled",
    ),
    { status: "ignore" },
  );
});

test("https login callbacks are not content links", () => {
  assert.equal(
    contentPathFromUrl("https://voxdex.com/login?code=abc").status,
    "ignore",
  );
  assert.equal(
    contentPathFromUrl("https://voxdex.com/login#access_token=t").status,
    "ignore",
  );
  assert.equal(
    contentPathFromUrl("https://voxdex.com/login/verify?code=abc").status,
    "ignore",
  );
});

test("https content URLs keep query and hash", () => {
  assert.deepEqual(
    contentPathFromUrl(
      "https://voxdex.com/person/abc?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile#comment-9",
    ),
    {
      status: "navigate",
      path: "/person/abc?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile#comment-9",
    },
  );
  assert.deepEqual(
    contentPathFromUrl(
      "https://voxdex.com/?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=referral",
    ),
    {
      status: "navigate",
      path: "/?ref=VXABCDEF&sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=referral",
    },
  );
  assert.deepEqual(
    contentPathFromUrl(
      "https://voxdex.com/?category=sports&search=ada&sortDir=asc#leaderboard",
    ),
    {
      status: "navigate",
      path: "/?category=sports&search=ada&sortDir=asc#leaderboard",
    },
  );
  assert.deepEqual(
    contentPathFromUrl("https://voxdex.com/share/bet/bet_123?sharer=user-1&utm_campaign=prediction_win"),
    {
      status: "navigate",
      path: "/share/bet/bet_123?sharer=user-1&utm_campaign=prediction_win",
    },
  );
});

test("share and referral paths map onto in-app routes", () => {
  const cases: Array<[string, string]> = [
    ["https://voxdex.com/polls/my-slug", "/polls/my-slug"],
    ["https://voxdex.com/vote/matchups/face-off", "/vote/matchups/face-off"],
    ["https://voxdex.com/vote/opinion-polls/pick-one", "/vote/opinion-polls/pick-one"],
    ["https://voxdex.com/predict/updown/m1", "/predict/updown/m1"],
    ["https://voxdex.com/predict/h2h/m2", "/predict/h2h/m2"],
    ["https://voxdex.com/predict/race/m3", "/predict/race/m3"],
    ["https://voxdex.com/markets/world-event", "/markets/world-event"],
    ["https://voxdex.com/u/ada", "/u/ada"],
    ["https://voxdex.com/vote", "/vote"],
    ["https://voxdex.com/vote?section=matchups", "/vote?section=matchups"],
    ["https://voxdex.com/predict", "/predict"],
    ["https://voxdex.com/predict?tab=world", "/predict?tab=world"],
    ["https://voxdex.com/person/abc/", "/person/abc"],
  ];

  for (const [input, path] of cases) {
    assert.deepEqual(contentPathFromUrl(input), { status: "navigate", path });
  }
});

test("disallowed hosts and paths are ignored", () => {
  const ignored = [
    "https://www.voxdex.com/person/abc",
    "http://voxdex.com/person/abc",
    "https://staging.voxdex.com/person/abc",
    "https://voxdex.com.evil.com/person/abc",
    "https://evil.com/person/abc",
    "https://voxdex.com:8443/person/abc",
    "https://user:pass@voxdex.com/person/abc",
    "https://voxdex.com/admin",
    "https://voxdex.com/admin/notifications",
    "https://voxdex.com/me",
    "https://voxdex.com/me/predictions",
    "https://voxdex.com/me/settings",
    "https://voxdex.com/api/og/person/abc",
    "https://voxdex.com/vote/induction",
    "https://voxdex.com/vote/all-ratings",
    "https://voxdex.com/predict/activity",
    "https://voxdex.com/insights",
    "https://voxdex.com/how-it-works",
    "https://voxdex.com/celebrity/abc",
    "https://voxdex.com/person",
    "https://voxdex.com/share/bet",
    "https://voxdex.com/share/other/x",
    "https://voxdex.com/person/../admin",
    "not a url",
  ];

  for (const input of ignored) {
    assert.equal(contentPathFromUrl(input).status, "ignore", input);
  }
});

test("assetlinks.json names com.voxdex.app and the debug cert SHA-256", () => {
  const raw = readFileSync(new URL("../public/.well-known/assetlinks.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as Array<{
    relation: string[];
    target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
  }>;
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0]?.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(parsed[0]?.target.namespace, "android_app");
  assert.equal(parsed[0]?.target.package_name, "com.voxdex.app");
  assert.deepEqual(parsed[0]?.target.sha256_cert_fingerprints, [
    CLOUD_AGENT_DEBUG_SHA256,
    PIXEL_DEBUG_SHA256,
  ]);
});
