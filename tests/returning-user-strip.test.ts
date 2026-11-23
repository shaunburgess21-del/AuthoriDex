import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SUPABASE_AUTH_STORAGE_KEY } from "../client/src/lib/authSession";
import {
  RESOLVED_LAST_SEEN_STORAGE_KEY,
  RETURNING_USER_ID_STORAGE_KEY,
  countNewlyResolvedPredictions,
  forgetReturningUser,
  readCachedReturningUserId,
  readResolvedLastSeenAt,
  rememberReturningUser,
  returningStripVisibleAtPaint,
  rowsFromPredictionsResponse,
  shouldShowReturningUserStrip,
  shouldStampResolvedLastSeen,
  stampResolvedLastSeenAt,
  streakStripLabel,
  xpRankProgress,
  xpRankProgressLabel,
  type StripStorage,
} from "../client/src/lib/returningUserStrip";

const votePage = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
const strip = readFileSync(
  new URL("../client/src/components/vote/ReturningUserStrip.tsx", import.meta.url),
  "utf8",
);
const userMenu = readFileSync(new URL("../client/src/components/UserMenu.tsx", import.meta.url), "utf8");

function memory(initial: Record<string, string> = {}): StripStorage & { snapshot(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
    snapshot: () => ({ ...data }),
  };
}

function throwingStorage(): StripStorage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

const USER = { id: "user-a" };
const ONBOARDED = "2026-05-01T12:00:00.000Z";

describe("returning user strip visibility", () => {
  it("shows only a signed-in user who finished onboarding outside their first session", () => {
    assert.equal(
      shouldShowReturningUserStrip({
        user: USER,
        onboardingCompletedAt: ONBOARDED,
        firstVisitSession: false,
      }),
      true,
    );
  });

  it("hides signed-out, unfinished, and first-visit visitors", () => {
    assert.equal(
      shouldShowReturningUserStrip({
        user: null,
        onboardingCompletedAt: ONBOARDED,
        firstVisitSession: false,
      }),
      false,
    );
    assert.equal(
      shouldShowReturningUserStrip({
        user: USER,
        onboardingCompletedAt: null,
        firstVisitSession: false,
      }),
      false,
    );
    assert.equal(
      shouldShowReturningUserStrip({
        user: USER,
        onboardingCompletedAt: "",
        firstVisitSession: false,
      }),
      false,
    );
    assert.equal(
      shouldShowReturningUserStrip({
        user: USER,
        onboardingCompletedAt: ONBOARDED,
        firstVisitSession: true,
      }),
      false,
    );
    assert.equal(
      shouldShowReturningUserStrip({
        user: null,
        onboardingCompletedAt: null,
        firstVisitSession: false,
      }),
      false,
    );
  });

  it("paints the slot from the persisted session while the profile is still loading", () => {
    assert.equal(
      returningStripVisibleAtPaint({
        user: null,
        onboardingCompletedAt: undefined,
        profileSettled: false,
        firstVisitSession: false,
        persistedUserId: "user-a",
        cachedReturningUserId: "user-a",
      }),
      true,
    );
    assert.equal(
      returningStripVisibleAtPaint({
        user: USER,
        onboardingCompletedAt: undefined,
        profileSettled: false,
        firstVisitSession: false,
        persistedUserId: "user-a",
        cachedReturningUserId: "user-a",
      }),
      true,
    );
  });

  it("does not paint early for a first visit, a mismatch, or a missing cache", () => {
    const base = {
      user: null,
      onboardingCompletedAt: undefined,
      profileSettled: false,
      persistedUserId: "user-a",
      cachedReturningUserId: "user-a",
    };
    assert.equal(returningStripVisibleAtPaint({ ...base, firstVisitSession: true }), false);
    assert.equal(
      returningStripVisibleAtPaint({
        ...base,
        firstVisitSession: false,
        cachedReturningUserId: "user-b",
      }),
      false,
    );
    assert.equal(
      returningStripVisibleAtPaint({
        ...base,
        firstVisitSession: false,
        cachedReturningUserId: null,
      }),
      false,
    );
    assert.equal(
      returningStripVisibleAtPaint({
        ...base,
        firstVisitSession: false,
        persistedUserId: null,
      }),
      false,
    );
  });

  it("trusts the settled profile over a stale cache", () => {
    assert.equal(
      returningStripVisibleAtPaint({
        user: USER,
        onboardingCompletedAt: null,
        profileSettled: true,
        firstVisitSession: false,
        persistedUserId: "user-a",
        cachedReturningUserId: "user-a",
      }),
      false,
    );
    assert.equal(
      returningStripVisibleAtPaint({
        user: USER,
        onboardingCompletedAt: ONBOARDED,
        profileSettled: true,
        firstVisitSession: false,
        persistedUserId: null,
        cachedReturningUserId: null,
      }),
      true,
    );
  });

  it("remembers and forgets the onboarded user id", () => {
    const store = memory();
    assert.equal(readCachedReturningUserId(store), null);
    rememberReturningUser(store, "user-a");
    assert.equal(readCachedReturningUserId(store), "user-a");
    forgetReturningUser(store);
    assert.equal(readCachedReturningUserId(store), null);
    assert.equal(readCachedReturningUserId(throwingStorage()), null);
    assert.doesNotThrow(() => rememberReturningUser(throwingStorage(), "user-a"));
    assert.doesNotThrow(() => forgetReturningUser(throwingStorage()));
  });
});

describe("resolved prediction count and last-seen stamp", () => {
  const won = "2026-11-01T00:00:00.000Z";
  const lost = "2026-11-10T00:00:00.000Z";
  const older = "2026-10-01T00:00:00.000Z";

  it("counts non-pending rows settled after the last-seen timestamp", () => {
    const rows = [
      { result: "pending", settledAt: lost },
      { result: "won", settledAt: won },
      { result: "lost", settledAt: lost },
      { result: "refunded", settledAt: lost },
      { result: "won", settledAt: older },
      { result: "won", settledAt: null },
      { result: "lost", settledAt: "not-a-date" },
    ];
    const lastSeen = Date.parse("2026-11-05T00:00:00.000Z");
    // won (Nov 1) and older are at or before the stamp. lost + refunded (Nov 10) count.
    assert.equal(countNewlyResolvedPredictions(rows, lastSeen), 2);
    assert.equal(countNewlyResolvedPredictions(rows, Date.parse(lost)), 0);
    assert.equal(countNewlyResolvedPredictions(rows, Date.parse(won)), 2);
    assert.equal(countNewlyResolvedPredictions([], lastSeen), 0);
  });

  it("treats a missing stamp as the epoch so every settled row counts", () => {
    const rows = [
      { result: "won", settledAt: older },
      { result: "pending", settledAt: won },
    ];
    assert.equal(countNewlyResolvedPredictions(rows, null), 1);
  });

  it("reads and writes the stamp, and ignores corrupt storage", () => {
    const store = memory();
    assert.equal(readResolvedLastSeenAt(store), null);
    stampResolvedLastSeenAt(store, 1_700_000_000_000);
    assert.equal(readResolvedLastSeenAt(store), 1_700_000_000_000);
    store.setItem(RESOLVED_LAST_SEEN_STORAGE_KEY, "nope");
    assert.equal(readResolvedLastSeenAt(store), null);
    store.setItem(RESOLVED_LAST_SEEN_STORAGE_KEY, "-5");
    assert.equal(readResolvedLastSeenAt(store), null);
    assert.equal(readResolvedLastSeenAt(throwingStorage()), null);
    assert.doesNotThrow(() => stampResolvedLastSeenAt(throwingStorage(), 10));
  });

  it("counts against the stamp that was read before it is updated", () => {
    const store = memory();
    const rows = [{ result: "won", settledAt: won }];
    const seenAt = readResolvedLastSeenAt(store);
    const count = countNewlyResolvedPredictions(rows, seenAt);
    stampResolvedLastSeenAt(store, Date.parse("2026-11-20T00:00:00.000Z"));
    assert.equal(count, 1);
    assert.equal(countNewlyResolvedPredictions(rows, readResolvedLastSeenAt(store)), 0);
    assert.equal(store.snapshot()[RESOLVED_LAST_SEEN_STORAGE_KEY], String(Date.parse("2026-11-20T00:00:00.000Z")));
  });

  it("reads the predictions envelope and the legacy array", () => {
    const row = { result: "won", settledAt: won, marketTitle: "Ignored" };
    assert.deepEqual(rowsFromPredictionsResponse({ predictions: [row, { result: 1 }, null] }), [
      { result: "won", settledAt: won, marketType: null },
      { result: "", settledAt: null, marketType: null },
    ]);
    assert.deepEqual(rowsFromPredictionsResponse([row]), [
      { result: "won", settledAt: won, marketType: null },
    ]);
    assert.deepEqual(rowsFromPredictionsResponse(null), []);
  });

  it("counts a newly settled row for every market type", () => {
    const settledAt = "2026-11-23T06:00:00.000Z";
    const lastSeen = Date.parse("2026-11-22T12:00:00.000Z");
    for (const marketType of ["updown", "h2h", "gainer", "jackpot", "community"] as const) {
      const rows = rowsFromPredictionsResponse({
        predictions: [
          {
            result: "won",
            settledAt,
            marketType,
            betId: marketType,
            marketTitle: "Sabrina Carpenter",
          },
        ],
      });
      assert.equal(rows[0]?.marketType, marketType);
      assert.equal(countNewlyResolvedPredictions(rows, lastSeen), 1, marketType);
      assert.equal(countNewlyResolvedPredictions(rows, Date.parse(settledAt)), 0, marketType);
    }
  });

  it("still counts a settlement time that arrives as a Date or epoch millis", () => {
    const at = Date.parse("2026-11-23T06:00:00.000Z");
    const rows = rowsFromPredictionsResponse({
      predictions: [
        { result: "won", settledAt: new Date(at), marketType: "updown" },
        { result: "lost", settledAt: at, marketType: "h2h" },
      ],
    });
    assert.equal(countNewlyResolvedPredictions(rows, at - 1), 2);
    assert.equal(rows[0]?.settledAt, new Date(at).toISOString());
  });

  it("stamps last-seen only when the results sheet opens", () => {
    assert.equal(shouldStampResolvedLastSeen("results-sheet"), true);
    for (const reason of ["mount", "fetch", "visibility-hidden", "unmount", "other-page"] as const) {
      assert.equal(shouldStampResolvedLastSeen(reason), false, reason);
    }
    const store = memory();
    const settledAt = "2026-11-23T06:00:00.000Z";
    const rows = [{ result: "won", settledAt, marketType: "updown" }];
    const seenAt = readResolvedLastSeenAt(store);
    const count = countNewlyResolvedPredictions(rows, seenAt);
    assert.equal(count, 1);
    assert.equal(readResolvedLastSeenAt(store), null);
    if (shouldStampResolvedLastSeen("results-sheet")) {
      stampResolvedLastSeenAt(store, Date.parse("2026-11-23T08:00:00.000Z"));
    }
    assert.equal(countNewlyResolvedPredictions(rows, readResolvedLastSeenAt(store)), 0);
  });
});

describe("streak and xp copy", () => {
  it("uses the zero-streak prompt and an N-day label", () => {
    assert.equal(streakStripLabel(0), "Start a streak today");
    assert.equal(streakStripLabel(-3), "Start a streak today");
    assert.equal(streakStripLabel(Number.NaN), "Start a streak today");
    assert.equal(streakStripLabel(1), "1-day streak");
    assert.equal(streakStripLabel(4.8), "4-day streak");
  });

  it("matches the avatar-menu rank ladder for xp remaining and progress", () => {
    const citizen = xpRankProgress(530);
    assert.equal(citizen.xpToNext, 470);
    assert.equal(citizen.nextRankName, "Aspirant");
    assert.equal(citizen.progressPct, 53);
    assert.equal(xpRankProgressLabel(citizen), "470 XP to Aspirant");

    const aspirant = xpRankProgress(1000);
    assert.equal(aspirant.xpToNext, 4000);
    assert.equal(aspirant.nextRankName, "Insider");
    assert.equal(aspirant.progressPct, 0);

    const top = xpRankProgress(400_000);
    assert.equal(top.xpToNext, null);
    assert.equal(top.nextRankName, null);
    assert.equal(top.progressPct, 100);
    assert.equal(xpRankProgressLabel(top), "Max rank reached");

    assert.equal(xpRankProgress(0).xpToNext, 1000);
    assert.equal(xpRankProgress(Number.NaN).xpToNext, 1000);
    assert.equal(xpRankProgress(-20).nextRankName, "Aspirant");
  });
});

describe("vote page placement", () => {
  it("renders the strip in the page container, under the chip band and above the feed", () => {
    const band = votePage.indexOf('data-testid="vote-sticky-band"');
    const container = votePage.indexOf("data-vote-all-layout");
    const slotUse = votePage.indexOf("<VoteWelcomeSlot ");
    const slot = readFileSync(
      new URL("../client/src/components/vote/WelcomeChecklist.tsx", import.meta.url),
      "utf8",
    );
    const sentiment = votePage.indexOf('title="Sentiment Polls"');
    const search = votePage.indexOf('placeholder="Search votes"');
    assert.ok(band > 0 && container > band && slotUse > container);
    assert.ok(slotUse < sentiment && slotUse < search);
    assert.match(slot, /<ReturningUserStrip \/>/);
    assert.match(slot, /returningStripAllowed/);
    assert.match(votePage, /sticky top-16 z-40 bg-background will-change-transform/);
    assert.equal(votePage.includes("top-16"), true);
    const bandBlock = votePage.slice(band, container);
    assert.equal(bandBlock.includes("ReturningUserStrip"), false);
  });

  it("keeps a fixed-height slot, latches visibility, and stamps only from the sheet", () => {
    assert.match(strip, /h-11/);
    assert.equal(strip.includes("sticky"), false);
    assert.match(strip, /useState\(\(\) =>\s*returningStripVisibleAtPaint/);
    assert.equal(strip.includes("visibilitychange"), false);
    assert.equal(strip.includes('visibilityState === "hidden"'), false);
    assert.match(strip, /shouldStampResolvedLastSeen\("results-sheet"\)/);
    assert.match(strip, /stampResolvedLastSeenAt/);
    assert.match(strip, /vote-return-strip-goal-slot/);
    assert.match(strip, /whitespace-nowrap/);
    assert.match(userMenu, /border-orange-500\/50 dark:border-orange-500\/40 text-orange-500 dark:text-orange-300/);
    assert.match(strip, /border-orange-500\/50 dark:border-orange-500\/40 text-orange-500 dark:text-orange-300/);
    assert.equal(strip.includes("today's goal") || strip.includes("Item 47"), true);
    assert.equal(strip.includes("/api/gamification/ranks"), false);
  });

  it("does not put the onboarding cache on the auth storage key", () => {
    assert.notEqual(RETURNING_USER_ID_STORAGE_KEY, SUPABASE_AUTH_STORAGE_KEY);
    assert.notEqual(RESOLVED_LAST_SEEN_STORAGE_KEY, SUPABASE_AUTH_STORAGE_KEY);
  });
});
