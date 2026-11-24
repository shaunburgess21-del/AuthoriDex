import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CREDIT_ACTIONS } from "../shared/credit-config";
import { createHash } from "node:crypto";
import {
  LEGACY_SHARER_USER_ID_SUNSET_ISO,
  SHARER_CLICK_LIMIT_PER_HOUR,
  SHARER_CLICK_WINDOW_MS,
  resetSharerClickLimiterForTests,
  trackShareClick,
  type ShareClickCreditMetadata,
  type ShareClickDecision,
  type ShareClickInsert,
  type TrackShareClickDeps,
  type TrackShareClickInput,
} from "../server/services/share-click-track";

const NOW = new Date("2026-11-23T15:04:00.000Z");
const DAY = "2026-11-23";
const EXTERNAL = "https://twitter.com/someone/status/1";

interface StoredClick {
  id: number;
  sharerUserId: string;
  ipHash: string;
  clickedAt: Date;
  credited: boolean;
  creditIdempotencyKey: string;
  shareSurface: string;
  shareUrl: string;
  externalReferrer: string | null;
}

interface CreditCall {
  userId: string;
  actionKey: string;
  idempotencyKey: string;
  metadata: ShareClickCreditMetadata;
}

function harness() {
  resetSharerClickLimiterForTests();
  const profiles = new Map<string, { id: string; code: string | null }>();
  const clicks: StoredClick[] = [];
  const creditCalls: CreditCall[] = [];
  const badgeCalls: string[] = [];
  const codeLookups: string[] = [];
  const idLookups: string[] = [];
  const logs: ShareClickDecision[] = [];
  let nextId = 1;
  let creditResult: { awarded: boolean; amount: number; reason?: string } = { awarded: true, amount: 5 };

  const deps: TrackShareClickDeps = {
    async findProfileById(id) {
      idLookups.push(id);
      const row = profiles.get(id);
      return row ? { id: row.id } : null;
    },
    async findProfileByReferralCode(code) {
      codeLookups.push(code);
      for (const row of profiles.values()) {
        if (row.code === code) return { id: row.id };
      }
      return null;
    },
    async findExistingToday(sharerUserId, ipHash, utcStart) {
      return clicks.some(
        (click) =>
          click.sharerUserId === sharerUserId &&
          click.ipHash === ipHash &&
          click.clickedAt >= utcStart,
      );
    },
    async countToday(sharerUserId, utcStart) {
      return clicks.filter(
        (click) => click.sharerUserId === sharerUserId && click.clickedAt >= utcStart,
      ).length;
    },
    async insertClick(row: ShareClickInsert) {
      if (clicks.some((click) => click.creditIdempotencyKey === row.creditIdempotencyKey)) {
        return "duplicate";
      }
      const id = nextId++;
      clicks.push({
        id,
        sharerUserId: row.sharerUserId,
        ipHash: row.ipHash,
        clickedAt: NOW,
        credited: false,
        creditIdempotencyKey: row.creditIdempotencyKey,
        shareSurface: row.shareSurface,
        shareUrl: row.shareUrl,
        externalReferrer: row.externalReferrer,
      });
      return { id };
    },
    async markCredited(id) {
      const row = clicks.find((click) => click.id === id);
      if (row) row.credited = true;
    },
    async adjustCredits(userId, actionKey, idempotencyKey, metadata) {
      creditCalls.push({ userId, actionKey, idempotencyKey, metadata });
      return creditResult;
    },
    async awardShareMaster(userId) {
      badgeCalls.push(userId);
    },
    log(decision) {
      logs.push(decision);
    },
  };

  return {
    profiles,
    clicks,
    creditCalls,
    badgeCalls,
    codeLookups,
    idLookups,
    logs,
    deps,
    setCreditResult(next: { awarded: boolean; amount: number; reason?: string }) {
      creditResult = next;
    },
  };
}

function request(
  body: TrackShareClickInput["body"],
  overrides: Partial<TrackShareClickInput> = {},
): TrackShareClickInput {
  return {
    body: {
      surface: "person_profile",
      shareUrl: "https://voxdex.com/person/ada?ref=VXAB12CD&utm_campaign=person_profile",
      ...body,
    },
    referer: EXTERNAL,
    ipKey: "203.0.113.8",
    callerUserId: null,
    now: NOW,
    ...overrides,
  };
}

describe("POST /api/share/track-click", () => {
  it("credits a click resolved from referralCode", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });

    const result = await trackShareClick(
      request({ referralCode: "vxab12cd" }),
      store.deps,
    );

    assert.deepEqual(result, { status: 200, body: { credited: true, creditsAwarded: 5 } });
    assert.deepEqual(store.codeLookups, ["VXAB12CD"]);
    assert.deepEqual(store.idLookups, []);
    assert.equal(store.creditCalls.length, 1);
    assert.equal(store.creditCalls[0]!.actionKey, "share_click");
    assert.equal(store.creditCalls[0]!.userId, "user-a");
    assert.equal(store.creditCalls[0]!.idempotencyKey, `share_click_user-a_${DAY}_1`);
    assert.deepEqual(store.creditCalls[0]!.metadata, {
      surface: "person_profile",
      shareUrl: "https://voxdex.com/person/ada?ref=VXAB12CD&utm_campaign=person_profile",
      shareClickId: 1,
    });
    assert.equal("amount" in store.creditCalls[0]!, false);
    assert.equal(store.clicks[0]!.credited, true);
    assert.deepEqual(store.badgeCalls, ["user-a"]);
  });

  it("still credits a legacy sharerUserId", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });

    const result = await trackShareClick(
      request({ sharerUserId: "user-a" }),
      store.deps,
    );

    assert.deepEqual(result, { status: 200, body: { credited: true, creditsAwarded: 5 } });
    assert.deepEqual(store.idLookups, ["user-a"]);
    assert.deepEqual(store.codeLookups, []);
    assert.equal(store.creditCalls[0]!.actionKey, "share_click");
    assert.equal(store.creditCalls[0]!.idempotencyKey, `share_click_user-a_${DAY}_1`);
    assert.equal(store.clicks[0]!.sharerUserId, "user-a");
  });

  it("returns 200 credited=false for an unknown referral code", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });

    const unknown = await trackShareClick(
      request({ referralCode: "VXZZZZZZ", sharerUserId: "user-a" }),
      store.deps,
    );
    const malformed = await trackShareClick(
      request({ referralCode: "not-a-code", sharerUserId: "user-a" }),
      store.deps,
    );

    assert.deepEqual(unknown, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.deepEqual(malformed, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.equal(store.clicks.length, 0);
    assert.equal(store.creditCalls.length, 0);
    assert.deepEqual(store.idLookups, []);
  });

  it("does not credit a self-click when the caller is the resolved sharer", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });

    const viaCode = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { callerUserId: "user-a" }),
      store.deps,
    );
    const viaLegacy = await trackShareClick(
      request({ sharerUserId: "user-a" }, { callerUserId: "user-a" }),
      store.deps,
    );
    const someoneElse = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { callerUserId: "user-b" }),
      store.deps,
    );

    assert.deepEqual(viaCode, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.deepEqual(viaLegacy, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.equal(store.clicks.length, 1);
    assert.equal(someoneElse.body.credited, true);
    assert.equal(store.creditCalls.length, 1);
    assert.equal(store.creditCalls[0]!.userId, "user-a");
  });

  it("keeps the per-sharer per-ip per-UTC-day dedup", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });

    const first = await trackShareClick(request({ referralCode: "VXAB12CD" }), store.deps);
    const repeat = await trackShareClick(request({ referralCode: "VXAB12CD" }), store.deps);
    const otherIp = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { ipKey: "203.0.113.9" }),
      store.deps,
    );

    assert.equal(first.body.credited, true);
    assert.deepEqual(repeat, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.equal(otherIp.body.credited, true);
    assert.equal(store.clicks.length, 2);
    assert.deepEqual(
      store.creditCalls.map((call) => call.idempotencyKey),
      [`share_click_user-a_${DAY}_1`, `share_click_user-a_${DAY}_2`],
    );
  });

  it("still lets adjustCredits enforce the daily cap and credit amount", async () => {
    const shareClick = CREDIT_ACTIONS.find((row) => row.key === "share_click");
    assert.ok(shareClick);
    assert.equal(shareClick.proposedCredits, 5);
    assert.equal(shareClick.dailyCap, 3);

    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    store.setCreditResult({ awarded: false, amount: 0 });

    const result = await trackShareClick(
      request({ sharerUserId: "user-a" }),
      store.deps,
    );

    assert.deepEqual(result, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.equal(store.clicks.length, 1);
    assert.equal(store.clicks[0]!.credited, false);
    assert.equal(store.creditCalls.length, 1);
    assert.equal(store.creditCalls[0]!.actionKey, "share_click");
    assert.equal("amount" in store.creditCalls[0]!, false);
    assert.equal(store.badgeCalls.length, 0);
    assert.equal(store.logs.at(-1)?.outcome, "cap");
  });

  it("credits a body referrer and falls back to the header only when the body is absent", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    const internalHeader = "https://voxdex.com/person/ada";

    const fromBody = await trackShareClick(
      request(
        { referralCode: "VXAB12CD", referrer: "https://twitter.com/someone/status/1" },
        { referer: internalHeader, ipKey: "203.0.113.21" },
      ),
      store.deps,
    );
    const bodyWinsOverExternalHeader = await trackShareClick(
      request(
        { referralCode: "VXAB12CD", referrer: "https://www.voxdex.com/me" },
        { referer: EXTERNAL, ipKey: "203.0.113.22" },
      ),
      store.deps,
    );
    const blankBodyUsesHeader = await trackShareClick(
      request(
        { referralCode: "VXAB12CD", referrer: "   " },
        { referer: EXTERNAL, ipKey: "203.0.113.23" },
      ),
      store.deps,
    );
    const oversizedBodyUsesHeader = await trackShareClick(
      request(
        { referralCode: "VXAB12CD", referrer: `https://evil.example/${"a".repeat(2100)}` },
        { referer: EXTERNAL, ipKey: "203.0.113.24" },
      ),
      store.deps,
    );

    assert.equal(fromBody.body.credited, true);
    assert.equal(store.clicks[0]!.externalReferrer, "https://twitter.com/someone/status/1");
    assert.equal(store.logs[0]!.referrerHost, "twitter.com");
    assert.equal(store.logs[0]!.outcome, "credited");
    assert.equal(bodyWinsOverExternalHeader.body.credited, false);
    assert.equal(store.logs[1]!.outcome, "internal");
    assert.equal(store.logs[1]!.referrerHost, "www.voxdex.com");
    assert.equal(blankBodyUsesHeader.body.credited, true);
    assert.equal(store.clicks[2]!.externalReferrer, EXTERNAL);
    assert.equal(oversizedBodyUsesHeader.body.credited, true);
    assert.equal(store.clicks[3]!.externalReferrer, EXTERNAL);
  });

  it("stops crediting legacy sharerUserId at the sunset instant without a lookup", async () => {
    const before = harness();
    before.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    const sunsetMs = Date.parse(LEGACY_SHARER_USER_ID_SUNSET_ISO);

    const stillOpen = await trackShareClick(
      request({ sharerUserId: "user-a" }, { now: new Date(sunsetMs - 1) }),
      before.deps,
    );
    assert.equal(stillOpen.body.credited, true);
    assert.deepEqual(before.idLookups, ["user-a"]);
    assert.equal(before.logs[0]!.path, "legacy");
    assert.equal(before.logs[0]!.outcome, "credited");

    const atSunset = harness();
    atSunset.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    const atInstant = await trackShareClick(
      request({ sharerUserId: "user-a" }, { now: new Date(sunsetMs), ipKey: "203.0.113.31" }),
      atSunset.deps,
    );
    const closed = await trackShareClick(
      request({ sharerUserId: "user-a" }, { now: new Date(sunsetMs + 1) }),
      atSunset.deps,
    );
    const after = await trackShareClick(
      request({ sharerUserId: "user-a" }, { now: new Date(sunsetMs + 60_000) }),
      atSunset.deps,
    );

    assert.equal(atInstant.body.credited, true);
    assert.deepEqual(closed, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.deepEqual(after, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.deepEqual(atSunset.idLookups, ["user-a"]);
    assert.equal(atSunset.clicks.length, 1);
    assert.equal(atSunset.logs[0]!.outcome, "credited");
    assert.equal(atSunset.logs[1]!.outcome, "sunset");
    assert.equal(atSunset.logs[1]!.path, "legacy");
    assert.equal(atSunset.logs[1]!.sharerId, null);
    assert.equal(atSunset.logs[2]!.outcome, "sunset");

    const afterCode = harness();
    afterCode.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    const codeStillWorks = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { now: new Date(sunsetMs + 60_000) }),
      afterCode.deps,
    );
    assert.equal(codeStillWorks.body.credited, true);
    assert.equal(afterCode.logs[0]!.path, "code");
    assert.deepEqual(afterCode.idLookups, []);
  });

  it("logs each decision with a hashed ip and a referrer host", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    const ip = "203.0.113.8";
    const expectedHash = createHash("sha256").update(ip).digest("hex");

    await trackShareClick(request({ referralCode: "VXAB12CD" }), store.deps);
    await trackShareClick(request({ referralCode: "VXAB12CD" }), store.deps);
    await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { callerUserId: "user-a", ipKey: "203.0.113.40" }),
      store.deps,
    );
    await trackShareClick(request({ referralCode: "VXNOPE00" }), store.deps);
    await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { referer: "https://localhost:5000/person/ada", ipKey: "203.0.113.41" }),
      store.deps,
    );

    assert.deepEqual(
      store.logs.map((line) => line.outcome),
      ["credited", "dedup", "self", "unknown", "internal"],
    );
    assert.equal(store.logs[0]!.sharerId, "user-a");
    assert.equal(store.logs[0]!.ipHash, expectedHash);
    assert.equal(store.logs[0]!.path, "code");
    assert.equal(store.logs[0]!.referrerHost, "twitter.com");
    assert.equal(store.logs[3]!.sharerId, null);
    assert.equal(JSON.stringify(store.logs).includes(ip), false);

    const lines: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      const quiet = harness();
      quiet.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
      await trackShareClick(
        request({ referralCode: "VXAB12CD" }, { ipKey: "203.0.113.50" }),
        { ...quiet.deps, log: undefined },
      );
    } finally {
      console.info = original;
    }
    const parsed = JSON.parse(lines.find((line) => line.includes("share-track-click")) ?? "{}") as ShareClickDecision & {
      source?: string;
    };
    assert.equal(parsed.source, "share-track-click");
    assert.equal(parsed.outcome, "credited");
    assert.equal(JSON.stringify(parsed).includes("203.0.113.50"), false);
  });

  it("caps insert attempts at 30 per sharer per hour without counting deduped or self clicks", async () => {
    const store = harness();
    store.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    store.profiles.set("user-b", { id: "user-b", code: "VXBB22CD" });

    for (let i = 0; i < SHARER_CLICK_LIMIT_PER_HOUR; i++) {
      const result = await trackShareClick(
        request({ referralCode: "VXAB12CD" }, { ipKey: `203.0.113.${i + 1}` }),
        store.deps,
      );
      assert.equal(result.body.credited, true);
    }
    const blocked = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { ipKey: "203.0.113.200" }),
      store.deps,
    );
    const repeat = await trackShareClick(
      request({ referralCode: "VXAB12CD" }, { ipKey: "203.0.113.1" }),
      store.deps,
    );
    assert.deepEqual(blocked, { status: 200, body: { credited: false, creditsAwarded: 0 } });
    assert.equal(store.logs.at(-2)?.outcome, "limited");
    assert.equal(repeat.body.credited, false);
    assert.equal(store.logs.at(-1)?.outcome, "dedup");
    assert.equal(store.clicks.length, SHARER_CLICK_LIMIT_PER_HOUR);

    const later = await trackShareClick(
      request(
        { referralCode: "VXAB12CD" },
        { ipKey: "203.0.113.201", now: new Date(NOW.getTime() + SHARER_CLICK_WINDOW_MS) },
      ),
      store.deps,
    );
    assert.equal(later.body.credited, true);

    const other = harness();
    other.profiles.set("user-a", { id: "user-a", code: "VXAB12CD" });
    other.profiles.set("user-b", { id: "user-b", code: "VXBB22CD" });
    for (let i = 0; i < SHARER_CLICK_LIMIT_PER_HOUR; i++) {
      await trackShareClick(
        request({ referralCode: "VXAB12CD" }, { ipKey: `198.51.100.${i + 1}` }),
        other.deps,
      );
    }
    for (let i = 0; i < 5; i++) {
      await trackShareClick(
        request({ referralCode: "VXAB12CD" }, { callerUserId: "user-a", ipKey: `198.51.100.${i + 1}` }),
        other.deps,
      );
    }
    const otherSharer = await trackShareClick(
      request({ referralCode: "VXBB22CD" }, { ipKey: "198.51.100.80" }),
      other.deps,
    );
    assert.equal(otherSharer.body.credited, true);
    assert.equal(other.logs.filter((line) => line.outcome === "self").length, 5);
  });
});
