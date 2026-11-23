import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CREDIT_ACTIONS } from "../shared/credit-config";
import {
  trackShareClick,
  type ShareClickCreditMetadata,
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
}

interface CreditCall {
  userId: string;
  actionKey: string;
  idempotencyKey: string;
  metadata: ShareClickCreditMetadata;
}

function harness() {
  const profiles = new Map<string, { id: string; code: string | null }>();
  const clicks: StoredClick[] = [];
  const creditCalls: CreditCall[] = [];
  const badgeCalls: string[] = [];
  const codeLookups: string[] = [];
  const idLookups: string[] = [];
  let nextId = 1;
  let creditResult: { awarded: boolean; amount: number } = { awarded: true, amount: 5 };

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
  };

  return {
    profiles,
    clicks,
    creditCalls,
    badgeCalls,
    codeLookups,
    idLookups,
    deps,
    setCreditResult(next: { awarded: boolean; amount: number }) {
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
  });
});
