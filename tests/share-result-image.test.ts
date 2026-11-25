import test from "node:test";
import assert from "node:assert/strict";

import {
  registerShareReferralCodeReader,
  resultImageSharePlan,
  shareResultImage,
} from "../client/src/lib/share";

test("result image share falls back to the link when the image cannot be delivered", () => {
  assert.equal(
    resultImageSharePlan({ canAttemptImage: false, imageReady: true, delivered: false }),
    "link",
  );
  assert.equal(
    resultImageSharePlan({ canAttemptImage: true, imageReady: false, delivered: false }),
    "link",
  );
  assert.equal(
    resultImageSharePlan({ canAttemptImage: true, imageReady: true, delivered: false }),
    "link",
  );
  assert.equal(
    resultImageSharePlan({ canAttemptImage: true, imageReady: true, delivered: true }),
    "image",
  );
});

function installGlobals(windowValue: unknown, navigatorValue: unknown) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
}

function restoreGlobals(windowValue: unknown, navigatorValue: unknown, fetchImpl: typeof fetch) {
  globalThis.fetch = fetchImpl;
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowValue });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigatorValue });
  registerShareReferralCodeReader(() => null);
}

test("shareResultImage copies the referral link when the card cannot be fetched", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const copied: string[] = [];

  registerShareReferralCodeReader(() => "VXAB12CD");
  installGlobals(
    {
      location: {
        origin: "https://voxdex.com",
        href: "https://voxdex.com/vote/matchups/seal-team",
      },
    },
    {
      clipboard: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  );
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  try {
    await shareResultImage({
      title: "Seal Team 6 vs Delta Force | VoxDex",
      imagePath: "/api/og/vote/matchups/seal-team.png?v=12",
      surface: "matchup",
      url: "https://voxdex.com/vote/matchups/seal-team",
    });
  } finally {
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.equal(copied.length, 1);
  const shared = new URL(copied[0]!);
  assert.equal(shared.origin + shared.pathname, "https://voxdex.com/vote/matchups/seal-team");
  assert.equal(shared.searchParams.get("ref"), "VXAB12CD");
  assert.equal(shared.searchParams.get("utm_source"), "voxdex");
  assert.equal(shared.searchParams.get("utm_medium"), "share");
  assert.equal(shared.searchParams.get("utm_campaign"), "matchup");
  assert.equal(shared.searchParams.has("sharer"), false);
  assert.equal(shared.searchParams.has("sharerUserId"), false);
});

test("shareResultImage sends the png when the device can share files", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const copied: string[] = [];
  const sharedPayloads: ShareData[] = [];

  registerShareReferralCodeReader(() => "VXAB12CD");
  const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" });
  installGlobals(
    {
      location: {
        origin: "https://voxdex.com",
        href: "https://voxdex.com/polls/jensen",
      },
    },
    {
      canShare: (data?: ShareData) => Array.isArray(data?.files) && data.files.length > 0,
      share: async (data: ShareData) => {
        sharedPayloads.push(data);
      },
      clipboard: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  );
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    assert.match(href, /\/api\/og\/vote\/polls\/jensen\.png/);
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;

  try {
    await shareResultImage({
      title: "The firing of Jensen Huang | VoxDex",
      imagePath: "/api/og/vote/polls/jensen.png?v=5",
      surface: "poll",
      url: "https://voxdex.com/polls/jensen?sharer=user-1",
    });
  } finally {
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.equal(copied.length, 0);
  assert.equal(sharedPayloads.length, 1);
  const payload = sharedPayloads[0]!;
  assert.equal(payload.files?.[0]?.type, "image/png");
  assert.equal(payload.files?.[0]?.name, "voxdex-vote.png");
  const shared = new URL(String(payload.url));
  assert.equal(shared.searchParams.get("ref"), "VXAB12CD");
  assert.equal(shared.searchParams.has("sharer"), false);
});
