import test from "node:test";
import assert from "node:assert/strict";

import { toast } from "sonner";
import {
  prefetchShareImage,
  registerShareReferralCodeReader,
  resetShareImageCacheForTests,
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
  resetShareImageCacheForTests();
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
  const png = new Blob([new Uint8Array(64)], { type: "image/png" });
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
    const warmed = await prefetchShareImage("/api/og/vote/polls/jensen.png?v=5");
    assert.ok(warmed);
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

test("an image that is not ready yet copies the link without waiting", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const copied: Array<{ url: string; fetchSettled: boolean }> = [];
  let fetchSettled = false;
  const toasts: string[] = [];
  const originalSuccess = toast.success;
  toast.success = ((message: unknown) => {
    toasts.push(String(message));
    return 1;
  }) as typeof toast.success;

  registerShareReferralCodeReader(() => "VXAB12CD");
  installGlobals(
    {
      location: {
        origin: "https://voxdex.com",
        href: "https://voxdex.com/vote/matchups/rainy-days-vs-sunny-days",
      },
    },
    {
      clipboard: {
        writeText: async (value: string) => {
          copied.push({ url: value, fetchSettled });
        },
      },
    },
  );
  globalThis.fetch = (() =>
    new Promise<Response>((resolve) => {
      setTimeout(() => {
        fetchSettled = true;
        resolve(new Response("<html>sso</html>", { status: 200, headers: { "content-type": "text/html" } }));
      }, 30);
    })) as typeof fetch;

  try {
    await shareResultImage({
      title: "Rainy Days vs Sunny Days | VoxDex",
      imagePath: "/api/og/vote/matchups/rainy-days-vs-sunny-days.png?v=12",
      surface: "matchup",
      url: "https://voxdex.com/vote/matchups/rainy-days-vs-sunny-days",
    });
  } finally {
    toast.success = originalSuccess;
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.equal(copied.length, 1);
  assert.equal(copied[0]!.fetchSettled, false);
  assert.equal(toasts[0], "Link copied!");
  const shared = new URL(copied[0]!.url);
  assert.equal(shared.searchParams.get("ref"), "VXAB12CD");
  assert.equal(shared.searchParams.has("sharer"), false);
});

test("a share sheet cancel stays silent", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const copied: string[] = [];
  const toasts: string[] = [];
  const originalSuccess = toast.success;
  const originalError = toast.error;
  toast.success = (() => {
    toasts.push("success");
    return 1;
  }) as typeof toast.success;
  toast.error = (() => {
    toasts.push("error");
    return 1;
  }) as typeof toast.error;

  const png = new Blob([new Uint8Array(64)], { type: "image/png" });
  installGlobals(
    { location: { origin: "https://voxdex.com", href: "https://voxdex.com/vote/matchups/rainy" } },
    {
      canShare: () => true,
      share: async () => {
        const err = new Error("Share canceled");
        err.name = "AbortError";
        throw err;
      },
      clipboard: { writeText: async (value: string) => { copied.push(value); } },
    },
  );
  globalThis.fetch = (async () =>
    new Response(png, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;

  try {
    await prefetchShareImage("/api/og/vote/matchups/rainy.png?v=12");
    await shareResultImage({
      title: "Rainy Days",
      imagePath: "/api/og/vote/matchups/rainy.png?v=12",
      surface: "matchup",
    });
  } finally {
    toast.success = originalSuccess;
    toast.error = originalError;
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.deepEqual(copied, []);
  assert.deepEqual(toasts, []);
});

test("a rejected share that is not a cancel still copies the link", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const copied: string[] = [];
  const toasts: string[] = [];
  const originalSuccess = toast.success;
  const originalError = toast.error;
  toast.success = ((message: unknown) => {
    toasts.push(String(message));
    return 1;
  }) as typeof toast.success;
  toast.error = ((message: unknown) => {
    toasts.push(String(message));
    return 1;
  }) as typeof toast.error;

  const png = new Blob([new Uint8Array(64)], { type: "image/png" });
  installGlobals(
    {
      location: { origin: "https://voxdex.com", href: "https://voxdex.com/vote/opinion-polls/best" },
      ClipboardItem: class ClipboardItem {},
    },
    {
      canShare: () => true,
      share: async () => {
        const err = new Error("Must be handling a user gesture");
        err.name = "NotAllowedError";
        throw err;
      },
      clipboard: {
        write: async () => {
          throw new Error("image clipboard unavailable");
        },
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  );
  globalThis.fetch = (async () =>
    new Response(png, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;

  try {
    await prefetchShareImage("/api/og/vote/opinion-polls/best.png?v=3");
    await shareResultImage({
      title: "Best female body type | VoxDex",
      imagePath: "/api/og/vote/opinion-polls/best.png?v=3",
      surface: "poll",
      url: "https://voxdex.com/vote/opinion-polls/best",
    });
  } finally {
    toast.success = originalSuccess;
    toast.error = originalError;
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.equal(copied.length, 1);
  assert.equal(toasts.includes("Link copied!"), true);
  assert.equal(new URL(copied[0]!).searchParams.has("sharer"), false);
});

test("share and clipboard both failing shows an error toast", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const toasts: string[] = [];
  const originalError = toast.error;
  toast.error = ((message: unknown) => {
    toasts.push(String(message));
    return 1;
  }) as typeof toast.error;

  installGlobals(
    { location: { origin: "https://voxdex.com", href: "https://voxdex.com/vote/matchups/rainy" } },
    {
      share: async () => {
        const err = new Error("Must be handling a user gesture");
        err.name = "NotAllowedError";
        throw err;
      },
      clipboard: {
        writeText: async () => {
          throw new Error("clipboard blocked");
        },
      },
    },
  );
  globalThis.fetch = (async () => new Promise<Response>(() => undefined)) as typeof fetch;

  try {
    await shareResultImage({
      title: "Rainy Days",
      imagePath: "/api/og/vote/matchups/rainy.png?v=12",
      surface: "matchup",
    });
  } finally {
    toast.error = originalError;
    restoreGlobals(previousWindow, previousNavigator, previousFetch);
  }

  assert.deepEqual(toasts, ["Could not copy link"]);
});
