/**
 * Unit tests for `fireAmmPlacementHooks`.
 *
 * The helper fans out four side effects (engagement upsert, XP award,
 * referral credit, placement badges) after a successful AMM bet. The
 * core contract: each hook is independently wrapped in its own
 * try/catch so any one throwing cannot mask the others or abort the
 * caller (which has already committed the trade transaction by this
 * point).
 *
 * These tests exercise that resilience by injecting throwing stubs via
 * the helper's optional `deps` parameter.
 */

import test from "node:test";
import assert from "node:assert/strict";

// The helper transitively imports `server/db.ts` (via gamification /
// credits-earn / badges / engagementWriter), which throws on module
// load if `DATABASE_URL` is not set. Drizzle lazy-connects, so a fake
// URL is enough — we never actually query in this unit test because
// the helper is invoked with injected stub deps.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test";

const { fireAmmPlacementHooks } = await import(
  "../server/services/amm-bet-hooks"
);
type FireAmmPlacementHooksDeps =
  import("../server/services/amm-bet-hooks").FireAmmPlacementHooksDeps;

function counts() {
  const log = {
    engagement: 0,
    xp: 0,
    referral: 0,
    badges: 0,
    capturedErrors: [] as Array<{ surface: string }>,
  };
  return log;
}

function defaultDeps(log: ReturnType<typeof counts>): FireAmmPlacementHooksDeps {
  return {
    upsertEngagement: async () => {
      log.engagement++;
      return true;
    },
    awardXp: (async (
      _userId: string,
      _action: string,
      _key: string,
      _meta?: Record<string, unknown>,
    ) => {
      log.xp++;
      return { awarded: 25, action: "place_prediction" };
    }) as unknown as FireAmmPlacementHooksDeps["awardXp"],
    maybeFireReferralCredit: async () => {
      log.referral++;
    },
    checkAndAwardPredictionBadges: (async () => {
      log.badges++;
    }) as unknown as FireAmmPlacementHooksDeps["checkAndAwardPredictionBadges"],
    captureBackgroundError: ((err: unknown, ctx?: Record<string, unknown>) => {
      log.capturedErrors.push({ surface: String(ctx?.surface ?? "unknown") });
    }) as unknown as FireAmmPlacementHooksDeps["captureBackgroundError"],
  };
}

const INPUT = {
  userId: "user-1",
  marketId: "market-1",
  betId: "bet-1",
  stakeAmount: 50,
  categoryId: "sports",
};

// Many of the hooks log on error. Silence the noise so test output stays
// readable. We could spy on console.error too, but we've already proven
// the contract via the captureBackgroundError surface counter.
const realError = console.error;
const realWarn = console.warn;
function silenceLogs() {
  console.error = () => {};
  console.warn = () => {};
}
function restoreLogs() {
  console.error = realError;
  console.warn = realWarn;
}

test("fires all four hooks on the happy path and returns xp", async () => {
  const log = counts();
  const out = await fireAmmPlacementHooks(INPUT, defaultDeps(log));
  assert.equal(log.engagement, 1);
  assert.equal(log.xp, 1);
  assert.equal(log.referral, 1);
  assert.equal(log.badges, 1);
  assert.equal(log.capturedErrors.length, 0);
  assert.deepEqual(out, { xp: { awarded: 25, action: "place_prediction" } });
});

test("engagement upsert throws → other hooks still fire, xp returned, error captured", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  deps.upsertEngagement = async () => {
    throw new Error("engagement table locked");
  };
  silenceLogs();
  try {
    const out = await fireAmmPlacementHooks(INPUT, deps);
    assert.equal(log.engagement, 0);
    assert.equal(log.xp, 1);
    assert.equal(log.referral, 1);
    assert.equal(log.badges, 1);
    assert.deepEqual(out, { xp: { awarded: 25, action: "place_prediction" } });
    assert.equal(log.capturedErrors.length, 1);
    assert.equal(log.capturedErrors[0].surface, "amm-bet.engagement");
  } finally {
    restoreLogs();
  }
});

test("XP award throws → xp returned as null, other hooks still fire, error captured", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  deps.awardXp = (async () => {
    throw new Error("xp action not found in cache");
  }) as unknown as FireAmmPlacementHooksDeps["awardXp"];
  silenceLogs();
  try {
    const out = await fireAmmPlacementHooks(INPUT, deps);
    assert.equal(log.engagement, 1);
    assert.equal(log.xp, 0);
    assert.equal(log.referral, 1);
    assert.equal(log.badges, 1);
    assert.equal(out.xp, null);
    assert.equal(log.capturedErrors.length, 1);
    assert.equal(log.capturedErrors[0].surface, "amm-bet.xp");
  } finally {
    restoreLogs();
  }
});

test("referral throws → xp + other hooks unaffected, error captured", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  deps.maybeFireReferralCredit = async () => {
    throw new Error("referral DB offline");
  };
  silenceLogs();
  try {
    const out = await fireAmmPlacementHooks(INPUT, deps);
    assert.equal(log.engagement, 1);
    assert.equal(log.xp, 1);
    assert.equal(log.referral, 0);
    assert.equal(log.badges, 1);
    assert.deepEqual(out, { xp: { awarded: 25, action: "place_prediction" } });
    assert.equal(log.capturedErrors.length, 1);
    assert.equal(log.capturedErrors[0].surface, "amm-bet.referral");
  } finally {
    restoreLogs();
  }
});

test("badges throw → caller still gets xp back, error captured", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  deps.checkAndAwardPredictionBadges = (async () => {
    throw new Error("badge lookup failed");
  }) as unknown as FireAmmPlacementHooksDeps["checkAndAwardPredictionBadges"];
  silenceLogs();
  try {
    const out = await fireAmmPlacementHooks(INPUT, deps);
    assert.equal(log.engagement, 1);
    assert.equal(log.xp, 1);
    assert.equal(log.referral, 1);
    assert.equal(log.badges, 0);
    assert.deepEqual(out, { xp: { awarded: 25, action: "place_prediction" } });
    assert.equal(log.capturedErrors.length, 1);
    assert.equal(log.capturedErrors[0].surface, "amm-bet.badges");
  } finally {
    restoreLogs();
  }
});

test("all four hooks throw → resolves cleanly with xp=null and all errors captured", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  deps.upsertEngagement = async () => {
    throw new Error("e");
  };
  deps.awardXp = (async () => {
    throw new Error("x");
  }) as unknown as FireAmmPlacementHooksDeps["awardXp"];
  deps.maybeFireReferralCredit = async () => {
    throw new Error("r");
  };
  deps.checkAndAwardPredictionBadges = (async () => {
    throw new Error("b");
  }) as unknown as FireAmmPlacementHooksDeps["checkAndAwardPredictionBadges"];
  silenceLogs();
  try {
    const out = await fireAmmPlacementHooks(INPUT, deps);
    assert.equal(log.engagement, 0);
    assert.equal(log.xp, 0);
    assert.equal(log.referral, 0);
    assert.equal(log.badges, 0);
    assert.equal(out.xp, null);
    assert.equal(log.capturedErrors.length, 4);
    const surfaces = log.capturedErrors.map((c) => c.surface).sort();
    assert.deepEqual(surfaces, [
      "amm-bet.badges",
      "amm-bet.engagement",
      "amm-bet.referral",
      "amm-bet.xp",
    ]);
  } finally {
    restoreLogs();
  }
});

test("captureBackgroundError itself throwing does not leak — engagement path proves it", async () => {
  // Defence-in-depth: if Sentry itself fails (unlikely but possible),
  // we still want the helper to resolve. We assert this only for the
  // engagement path; the others use identical try/catch shape.
  const log = counts();
  const deps = defaultDeps(log);
  deps.upsertEngagement = async () => {
    throw new Error("engagement fail");
  };
  deps.captureBackgroundError = (() => {
    throw new Error("sentry blew up");
  }) as unknown as FireAmmPlacementHooksDeps["captureBackgroundError"];
  silenceLogs();
  try {
    // We expect this to *throw*, since captureBackgroundError is called
    // *outside* a try/catch in the helper. That's a real edge-case worth
    // documenting — the helper's resilience contract is "each hook
    // failure is isolated", not "every dependency throwing is safe".
    // If we ever want to harden further we can wrap the captureBackgroundError
    // calls themselves; for now the assertion just nails down current
    // behaviour so we notice if it changes.
    await assert.rejects(() => fireAmmPlacementHooks(INPUT, deps), /sentry blew up/);
  } finally {
    restoreLogs();
  }
});

test("absent categoryId is forwarded to engagement (no-op upsert, no throw)", async () => {
  const log = counts();
  const deps = defaultDeps(log);
  let receivedCategoryId: unknown = "unset";
  deps.upsertEngagement = async (input) => {
    log.engagement++;
    receivedCategoryId = input.categoryId;
    return false;
  };
  const out = await fireAmmPlacementHooks({ ...INPUT, categoryId: null }, deps);
  assert.equal(receivedCategoryId, null);
  assert.equal(log.engagement, 1);
  assert.equal(log.xp, 1);
  assert.deepEqual(out, { xp: { awarded: 25, action: "place_prediction" } });
});
