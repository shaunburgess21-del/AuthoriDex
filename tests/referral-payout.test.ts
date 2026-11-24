import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CREDIT_ACTIONS, SIGNUP_CREDIT_GRANT } from "../shared/credit-config";
import {
  drainReferralPayouts,
  fireReferralCredit,
  referralPayoutIdempotencyKey,
  type PendingReferral,
  type ReferralPayInput,
  type ReferralPayResult,
  type ReferralPayoutDeps,
} from "../server/services/referral-payout";

const DAY_1 = new Date("2026-11-24T18:00:00.000Z");
const DAY_2 = new Date("2026-11-25T08:00:00.000Z");

interface Referee {
  id: string;
  referredBy: string | null;
  firstActionAt: Date | null;
}

interface Payout {
  referrerId: string;
  refereeId: string;
  idempotencyKey: string;
  at: Date;
  amount: number;
}

function harness(dailyCap: number | null = 3) {
  const profiles = new Map<string, Referee>();
  const payouts: Payout[] = [];
  const payCalls: ReferralPayInput[] = [];
  const paidNotices: string[] = [];
  const duplicateStamps: string[] = [];
  let clock = DAY_1;
  let forced: ReferralPayResult | null = null;
  let failStamp = false;

  function unpaid(referrerId: string): PendingReferral[] {
    return [...profiles.values()]
      .filter(
        (profile) =>
          profile.referredBy === referrerId &&
          profile.firstActionAt !== null &&
          !payouts.some((payout) => payout.refereeId === profile.id),
      )
      .sort((a, b) => a.firstActionAt!.getTime() - b.firstActionAt!.getTime())
      .map((profile) => ({ refereeId: profile.id, firstActionAt: profile.firstActionAt! }));
  }

  const deps: ReferralPayoutDeps & {
    loadReferee: (userId: string) => Promise<Referee | null>;
    stampFirstAction: (userId: string, now: Date) => Promise<boolean>;
  } = {
    dailyCap,
    async countPaidToday(referrerId, utcStart) {
      return payouts.filter(
        (payout) => payout.referrerId === referrerId && payout.at >= utcStart,
      ).length;
    },
    async listUnpaid(referrerId, limit) {
      return unpaid(referrerId).slice(0, limit);
    },
    async referrerExists(referrerId) {
      return profiles.has(referrerId);
    },
    async pay(input) {
      payCalls.push(input);
      if (forced) return forced;
      if (payouts.some((payout) => payout.idempotencyKey === input.idempotencyKey)) {
        return { awarded: false, amount: 0, reason: "duplicate" };
      }
      payouts.push({ ...input, at: clock, amount: 5000 });
      return { awarded: true, amount: 5000 };
    },
    async onPaid(input) {
      paidNotices.push(input.refereeId);
      assert.equal(input.amount, 5000);
    },
    async onAlreadyRecorded(referrerId) {
      duplicateStamps.push(referrerId);
    },
    async loadReferee(userId) {
      return profiles.get(userId) ?? null;
    },
    async stampFirstAction(userId, now) {
      if (failStamp) return false;
      const profile = profiles.get(userId);
      if (!profile || profile.firstActionAt) return false;
      profile.firstActionAt = now;
      return true;
    },
  };

  return {
    profiles,
    payouts,
    payCalls,
    paidNotices,
    duplicateStamps,
    deps,
    setClock(next: Date) {
      clock = next;
    },
    setForced(next: ReferralPayResult | null) {
      forced = next;
    },
    setFailStamp(next: boolean) {
      failStamp = next;
    },
    add(profile: Referee) {
      profiles.set(profile.id, profile);
    },
  };
}

describe("referral payout cap", () => {
  it("keeps the signup amounts and caps referral_completed at 3 per day", () => {
    const completed = CREDIT_ACTIONS.find((row) => row.key === "referral_completed");
    const bonus = CREDIT_ACTIONS.find((row) => row.key === "referral_signup_bonus");
    assert.ok(completed);
    assert.ok(bonus);
    assert.equal(completed.proposedCredits, 5000);
    assert.equal(completed.dailyCap, 3);
    assert.equal(bonus.proposedCredits, 5000);
    assert.equal(bonus.dailyCap, null);
    assert.equal(SIGNUP_CREDIT_GRANT, 10000);

    const gamification = readFileSync(
      new URL("../server/services/gamification.ts", import.meta.url),
      "utf8",
    );
    const unscaled = gamification.match(/UNSCALED_CREDIT_ACTIONS = new Set<string>\(\[([\s\S]*?)\]\)/);
    assert.ok(unscaled);
    assert.match(unscaled[1]!, /signup_grant/);
    assert.doesNotMatch(unscaled[1]!, /referral_completed/);

    const earn = readFileSync(new URL("../server/services/credits-earn.ts", import.meta.url), "utf8");
    assert.match(earn, /'referral_' \|\| p\.id/);
    const payCall = earn.slice(earn.indexOf("async function payReferral"), earn.indexOf("async function stampReferralFiredAt"));
    const adjustCall = payCall.slice(payCall.indexOf("adjustCredits"), payCall.indexOf("return {"));
    assert.match(adjustCall, /"referral_completed"/);
    assert.doesNotMatch(adjustCall, /\bamount\s*:/);
    const checkin = readFileSync(
      new URL("../server/route-modules/gamification-routes.ts", import.meta.url),
      "utf8",
    );
    assert.equal(checkin.split("sweepReferrerReferralPayouts(").length - 1, 2);

    const migration = readFileSync(
      new URL("../migrations/0106_referral_completed_daily_cap.sql", import.meta.url),
      "utf8",
    );
    const journal = readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8");
    assert.match(migration, /SET daily_cap = 3/);
    assert.match(migration, /WHERE key = 'referral_completed'/);
    assert.doesNotMatch(migration, /proposed_credits/i);
    assert.match(journal, /0106_referral_completed_daily_cap/);
  });

  it("refuses a self-referral and a missing referrer before paying", async () => {
    const self = harness();
    self.add({ id: "user-a", referredBy: "user-a", firstActionAt: null });
    const selfResult = await fireReferralCredit("user-a", self.deps, DAY_1);
    assert.equal(selfResult.outcome, "self");
    assert.equal(self.payCalls.length, 0);
    assert.equal(self.profiles.get("user-a")!.firstActionAt?.toISOString(), DAY_1.toISOString());

    const missing = harness();
    missing.add({ id: "user-b", referredBy: "gone", firstActionAt: null });
    const missingResult = await fireReferralCredit("user-b", missing.deps, DAY_1);
    assert.equal(missingResult.outcome, "missing_referrer");
    assert.equal(missing.payCalls.length, 0);

    const queued = harness();
    queued.add({ id: "referrer", referredBy: null, firstActionAt: null });
    queued.add({ id: "referrer", referredBy: null, firstActionAt: DAY_1 });
    const skipped = await drainReferralPayouts(
      "referrer",
      {
        ...queued.deps,
        listUnpaid: async () => [{ refereeId: "referrer", firstActionAt: DAY_1 }],
      },
      DAY_1,
    );
    assert.deepEqual(skipped.paidRefereeIds, []);
    assert.equal(queued.payCalls.length, 0);
  });

  it("pays at most 3 per UTC day, oldest first, and pays the deferred friend once later", async () => {
    const store = harness(3);
    store.add({ id: "referrer", referredBy: null, firstActionAt: null });
    const friends = ["friend-1", "friend-2", "friend-3", "friend-4"];
    friends.forEach((id, index) => {
      store.add({
        id,
        referredBy: "referrer",
        firstActionAt: new Date(Date.parse("2026-11-24T10:00:00.000Z") + index * 60_000),
      });
    });

    const first = await drainReferralPayouts("referrer", store.deps, DAY_1);
    assert.deepEqual(first.paidRefereeIds, ["friend-1", "friend-2", "friend-3"]);
    assert.equal(first.hitCap, false);
    assert.deepEqual(
      store.payCalls.map((call) => call.idempotencyKey),
      friends.slice(0, 3).map((id) => referralPayoutIdempotencyKey(id)),
    );
    assert.deepEqual(store.paidNotices, ["friend-1", "friend-2", "friend-3"]);

    store.setClock(DAY_1);
    const sameDay = await drainReferralPayouts("referrer", store.deps, DAY_1);
    assert.deepEqual(sameDay.paidRefereeIds, []);
    assert.equal(sameDay.hitCap, true);
    assert.equal(store.payCalls.length, 3);

    store.setClock(DAY_2);
    const nextDay = await drainReferralPayouts("referrer", store.deps, DAY_2);
    assert.deepEqual(nextDay.paidRefereeIds, ["friend-4"]);
    assert.deepEqual(
      store.payouts.map((payout) => payout.idempotencyKey),
      friends.map((id) => `referral_${id}`),
    );
    assert.equal(new Set(store.payouts.map((payout) => payout.idempotencyKey)).size, 4);

    store.setClock(DAY_2);
    const again = await drainReferralPayouts("referrer", store.deps, DAY_2);
    assert.deepEqual(again.paidRefereeIds, []);
    assert.equal(store.payCalls.length, 4);
  });

  it("does not lose a friend when adjustCredits reports the daily cap, and does not pay twice", async () => {
    const store = harness(3);
    store.add({ id: "referrer", referredBy: null, firstActionAt: null });
    store.add({
      id: "friend-old",
      referredBy: "referrer",
      firstActionAt: new Date("2026-11-24T09:00:00.000Z"),
    });
    store.add({
      id: "friend-new",
      referredBy: "referrer",
      firstActionAt: null,
    });

    let calls = 0;
    store.setForced(null);
    store.deps.pay = async (input) => {
      calls += 1;
      store.payCalls.push(input);
      if (calls === 1) {
        store.payouts.push({ ...input, at: DAY_1, amount: 5000 });
        return { awarded: true, amount: 5000 };
      }
      return { awarded: false, amount: 0, reason: "daily_cap" };
    };

    const fired = await fireReferralCredit("friend-new", store.deps, DAY_1);
    assert.equal(fired.outcome, "drained");
    assert.deepEqual(fired.paidRefereeIds, ["friend-old"]);
    assert.equal(store.profiles.get("friend-new")!.firstActionAt?.toISOString(), DAY_1.toISOString());
    assert.equal(store.payCalls.at(-1)?.refereeId, "friend-new");
    assert.equal(store.payCalls.at(-1)?.idempotencyKey, "referral_friend-new");

    store.deps.pay = async (input) => {
      store.payCalls.push(input);
      if (store.payouts.some((payout) => payout.idempotencyKey === input.idempotencyKey)) {
        return { awarded: false, amount: 0, reason: "duplicate" };
      }
      store.payouts.push({ ...input, at: DAY_2, amount: 5000 });
      return { awarded: true, amount: 5000 };
    };
    store.setClock(DAY_2);
    const next = await drainReferralPayouts("referrer", store.deps, DAY_2);
    assert.deepEqual(next.paidRefereeIds, ["friend-new"]);
    assert.equal(store.paidNotices.filter((id) => id === "friend-new").length, 1);

    const duplicate = await drainReferralPayouts("referrer", {
      ...store.deps,
      listUnpaid: async () => [{ refereeId: "friend-new", firstActionAt: DAY_1 }],
    }, DAY_2);
    assert.deepEqual(duplicate.paidRefereeIds, []);
    assert.deepEqual(store.duplicateStamps, ["referrer"]);
    assert.equal(store.payouts.filter((payout) => payout.refereeId === "friend-new").length, 1);
  });

  it("stamps an organic user once and leaves a lost stamp race unpaid by this call", async () => {
    const organic = harness();
    organic.add({ id: "user-c", referredBy: null, firstActionAt: null });
    const stamped = await fireReferralCredit("user-c", organic.deps, DAY_1);
    assert.equal(stamped.outcome, "stamped_only");
    const repeat = await fireReferralCredit("user-c", organic.deps, DAY_1);
    assert.equal(repeat.outcome, "already_acted");
    assert.equal(organic.payCalls.length, 0);

    const raced = harness();
    raced.add({ id: "friend", referredBy: "referrer", firstActionAt: null });
    raced.add({ id: "referrer", referredBy: null, firstActionAt: null });
    raced.setFailStamp(true);
    const lost = await fireReferralCredit("friend", raced.deps, DAY_1);
    assert.equal(lost.outcome, "already_acted");
    assert.equal(raced.payCalls.length, 0);
  });
});
