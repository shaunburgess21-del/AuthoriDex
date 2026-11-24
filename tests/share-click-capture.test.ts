import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { registerShareReferralCodeReader } from "../client/src/lib/share";
import {
  armShareClickFromUrl,
  captureReferralFromUrl,
  captureShareClickFromUrl,
  getStoredReferralCode,
  resetShareClickCaptureForTests,
} from "../client/src/lib/referral-capture";

const REFERRAL_KEY = "voxdex_referral_code";

interface FetchCall {
  url: string;
  body: Record<string, unknown> | null;
}

const calls: FetchCall[] = [];
const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
const previousDocument = globalThis.document;

function installWindow(href: string) {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
  const location = { href };
  const history = {
    replaceState(_state: unknown, _title: string, next?: string | URL | null) {
      if (next == null) return;
      location.href = new URL(String(next), new URL(location.href).origin).toString();
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location, history, localStorage },
  });
  return { location, storage };
}

async function land(currentUserId: string | null) {
  armShareClickFromUrl();
  captureReferralFromUrl();
  await captureShareClickFromUrl(currentUserId);
}

afterEach(() => {
  resetShareClickCaptureForTests();
  registerShareReferralCodeReader(() => null);
  calls.length = 0;
  globalThis.fetch = previousFetch;
  Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
});

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    return new Response(JSON.stringify({ credited: false, creditsAwarded: 0 }), { status: 200 });
  }) as typeof fetch;
}

describe("share click capture", () => {
  it("posts the referral code for a share landing and still stashes ref for signup", async () => {
    const { location } = installWindow(
      "https://voxdex.com/person/ada?ref=vxab12cd&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile",
    );
    installFetch();

    await land(null);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "/api/share/track-click");
    assert.equal(calls[0]!.body?.referralCode, "VXAB12CD");
    assert.equal(calls[0]!.body?.surface, "person_profile");
    assert.equal("sharerUserId" in (calls[0]!.body ?? {}), false);
    assert.equal(typeof calls[0]!.body?.referrer, "string");
    assert.equal(String(calls[0]!.body?.shareUrl).includes("ref=vxab12cd"), true);
    assert.equal(getStoredReferralCode(), "VXAB12CD");
    assert.equal(new URL(location.href).searchParams.has("ref"), false);
    assert.equal(new URL(location.href).searchParams.has("utm_source"), false);
    assert.equal(new URL(location.href).searchParams.has("sharer"), false);

    await captureShareClickFromUrl(null);
    assert.equal(calls.length, 1);
  });

  it("leaves a bare referral link to signup capture and does not track a click", async () => {
    installWindow("https://voxdex.com/?ref=VXAB12CD");
    installFetch();

    await land(null);

    assert.equal(calls.length, 0);
    assert.equal(getStoredReferralCode(), "VXAB12CD");
  });

  it("still posts a legacy sharer UUID and does not touch the signup stash", async () => {
    const { location, storage } = installWindow(
      "https://voxdex.com/markets/world?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=market",
    );
    installFetch();

    await land("someone-else");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body?.sharerUserId, "user-1");
    assert.equal("referralCode" in (calls[0]!.body ?? {}), false);
    assert.equal(storage.get(REFERRAL_KEY), undefined);
    assert.equal(new URL(location.href).searchParams.has("sharer"), false);
    assert.equal(new URL(location.href).searchParams.has("utm_campaign"), false);
  });

  it("skips a self-click for a legacy sharer and for the viewer's own referral code", async () => {
    installWindow(
      "https://voxdex.com/person/ada?sharer=user-1&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile",
    );
    installFetch();
    await land("user-1");
    assert.equal(calls.length, 0);

    resetShareClickCaptureForTests();
    registerShareReferralCodeReader(() => "VXAB12CD");
    installWindow(
      "https://voxdex.com/person/ada?ref=VXAB12CD&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile",
    );
    await land("user-1");
    assert.equal(calls.length, 0);
    assert.equal(getStoredReferralCode(), "VXAB12CD");
  });

  it("posts the landing referrer captured before share params are stripped", async () => {
    let current = "https://t.co/abc123";
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        get referrer() {
          return current;
        },
      },
    });
    installWindow(
      "https://voxdex.com/person/ada?ref=vxab12cd&utm_source=voxdex&utm_medium=share&utm_campaign=person_profile",
    );
    installFetch();

    armShareClickFromUrl();
    current = "https://voxdex.com/person/ada";
    captureReferralFromUrl();
    await captureShareClickFromUrl(null);

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.body?.referrer, "https://t.co/abc123");
    assert.equal(calls[0]!.body?.referralCode, "VXAB12CD");
  });

  it("wires the signed-in referral code into share URLs through the hook cache", () => {
    const hook = readFileSync(new URL("../client/src/hooks/useReferralLink.ts", import.meta.url), "utf8");
    assert.match(hook, /registerShareReferralCodeReader/);
    assert.match(hook, /getQueryData<ReferralStats>\(REFERRAL_STATS_KEY\)/);
  });
});
