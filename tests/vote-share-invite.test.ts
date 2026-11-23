import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CREDIT_ACTIONS } from "../shared/credit-config";
import { voxWord } from "../shared/currency";
import {
  GOAL_INVITE_INTERVAL_MS,
  goalInviteDismissedKey,
  goalInviteOpen,
  goalInviteShownKey,
  readGoalInviteDismissed,
  readGoalInviteShownAt,
  writeGoalInviteDismissed,
  writeGoalInviteShownAt,
  type GoalInviteStorage,
} from "../client/src/lib/goalInvite";
import {
  goalDoneInviteCopy,
  referralRewardAmounts,
  referralRewardSentence,
} from "../client/src/lib/referralRewardCopy";
import { appendShareAttribution } from "../client/src/lib/share";
import {
  LINK_COPIED_TOAST,
  buildVoteCardShareUrl,
  deliverShareLink,
  referralCodeForShare,
  voteCrowdShareText,
  withReferralParam,
} from "../client/src/lib/voteCardShare";

function memoryStorage(): GoalInviteStorage & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (key) => (dump.has(key) ? dump.get(key)! : null),
    setItem: (key, value) => {
      dump.set(key, value);
    },
  };
}

const WEEK = GOAL_INVITE_INTERVAL_MS;
const NOW = Date.parse("2026-11-23T18:00:00.000Z");

describe("crowd line share text", () => {
  it("prefills the user's percent and the card headline", () => {
    assert.equal(
      voteCrowdShareText(55, "Who is the GOAT?"),
      `I'm with 55% on "Who is the GOAT?" on VoxDex`,
    );
    assert.equal(
      voteCrowdShareText(28, "Ronaldo or Messi?"),
      `I'm with 28% on "Ronaldo or Messi?" on VoxDex`,
    );
  });

  it("rounds the percent and keeps the headline on one phrase", () => {
    assert.equal(voteCrowdShareText(54.6, "  A  vs   B  "), `I'm with 55% on "A vs B" on VoxDex`);
    assert.equal(voteCrowdShareText(-4, `Say "hi"`), `I'm with 0% on "Say 'hi'" on VoxDex`);
    assert.equal(voteCrowdShareText(Number.NaN, "   "), `I'm with 0% on "this vote" on VoxDex`);
  });
});

describe("crowd line share fallback", () => {
  const payload = {
    title: `I'm with 55% on "Who is the GOAT?" on VoxDex`,
    text: `I'm with 55% on "Who is the GOAT?" on VoxDex`,
    url: "https://voxdex.com/vote/matchups/goat?ref=VXABCDEF",
  };

  it("uses the native sheet when it opens", async () => {
    let copied = false;
    const result = await deliverShareLink(payload, {
      systemSheet: async () => "shared",
      webShare: async () => {
        throw new Error("should not run");
      },
      writeText: async () => {
        copied = true;
      },
      notifyCopied: () => {
        copied = true;
      },
    });
    assert.equal(result, "shared");
    assert.equal(copied, false);
  });

  it("does not toast when the sheet is cancelled", async () => {
    let toasted: string | null = null;
    const result = await deliverShareLink(payload, {
      systemSheet: async () => "cancelled",
      webShare: null,
      writeText: async () => {
        throw new Error("should not copy");
      },
      notifyCopied: (message) => {
        toasted = message;
      },
    });
    assert.equal(result, "cancelled");
    assert.equal(toasted, null);
  });

  it("falls through to navigator.share", async () => {
    let shared = "";
    const result = await deliverShareLink(payload, {
      systemSheet: async () => "unavailable",
      webShare: async (data) => {
        shared = data.text ?? "";
      },
      writeText: async () => {
        throw new Error("should not copy");
      },
      notifyCopied: () => {
        throw new Error("should not toast");
      },
    });
    assert.equal(result, "shared");
    assert.equal(shared, payload.text);
  });

  it("copies the link and toasts Link copied when share is unavailable", async () => {
    let written = "";
    let toasted = "";
    const result = await deliverShareLink(payload, {
      systemSheet: async () => "unavailable",
      webShare: null,
      writeText: async (value) => {
        written = value;
      },
      notifyCopied: (message) => {
        toasted = message;
      },
    });
    assert.equal(result, "copied");
    assert.equal(written, payload.url);
    assert.equal(toasted, "Link copied");
    assert.equal(LINK_COPIED_TOAST, "Link copied");
  });

  it("uses the textarea fallback when the clipboard rejects", async () => {
    let fallback = "";
    const result = await deliverShareLink(payload, {
      systemSheet: async () => "unavailable",
      webShare: async () => {
        const err = new Error("not allowed");
        err.name = "NotAllowedError";
        throw err;
      },
      writeText: async () => {
        throw new Error("denied");
      },
      fallbackCopy: (value) => {
        fallback = value;
        return true;
      },
      notifyCopied: (message) => {
        assert.equal(message, LINK_COPIED_TOAST);
      },
    });
    assert.equal(result, "copied");
    assert.equal(fallback, payload.url);
  });
});

describe("referral code on the card link", () => {
  it("adds a valid ref and leaves other codes off the link", () => {
    assert.equal(referralCodeForShare(" vxab12cd "), "VXAB12CD");
    assert.equal(referralCodeForShare("nope"), null);
    assert.equal(referralCodeForShare(null), null);
    const base = "https://voxdex.com/vote/matchups/goat?utm_campaign=matchup";
    const withCode = new URL(withReferralParam(base, "vxab12cd"));
    assert.equal(withCode.searchParams.get("ref"), "VXAB12CD");
    assert.equal(withCode.searchParams.get("sharer"), null);
    assert.equal(withCode.toString().includes("sharer"), false);
    assert.equal(withReferralParam(base, "not-a-code"), base);
    assert.equal(withReferralParam(`${base}&ref=VXZZZZZZ`, "VXAB12CD").includes("ref=VXZZZZZZ"), true);
    assert.equal(new URL(withReferralParam(`${base}&ref=VXZZZZZZ`, "VXAB12CD")).searchParams.getAll("ref").length, 1);
  });

  it("builds an attributed card url and appends ref only for a real code", () => {
    const previous = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://voxdex.com" } },
    });
    try {
      const url = new URL(
        buildVoteCardShareUrl({
          headline: "Who is the GOAT?",
          percent: 55,
          path: "/vote/matchups/goat",
          surface: "matchup",
          referralCode: "VXAB12CD",
        }),
      );
      assert.equal(url.origin, "https://voxdex.com");
      assert.equal(url.pathname, "/vote/matchups/goat");
      assert.equal(url.searchParams.get("ref"), "VXAB12CD");
      assert.equal(url.searchParams.get("sharer"), null);
      assert.equal(url.toString().includes("sharer"), false);
      assert.equal(url.searchParams.get("utm_source"), "voxdex");
      assert.equal(url.searchParams.get("utm_medium"), "share");
      assert.equal(url.searchParams.get("utm_campaign"), "matchup");

      const plain = new URL(
        buildVoteCardShareUrl({
          headline: "Who is the GOAT?",
          percent: 55,
          path: "/vote/matchups/goat",
          surface: "matchup",
          referralCode: "invalid",
        }),
      );
      assert.equal(plain.searchParams.get("ref"), null);
      assert.equal(plain.searchParams.get("sharer"), null);

      const stripped = new URL(
        appendShareAttribution(
          "https://voxdex.com/person/ada?sharer=11111111-2222-3333-4444-555555555555&utm_source=voxdex",
          { referralCode: "VXAB12CD", surface: "person_profile" },
        ),
      );
      assert.equal(stripped.searchParams.get("sharer"), null);
      assert.equal(stripped.toString().includes("sharer"), false);
      assert.equal(stripped.searchParams.get("ref"), "VXAB12CD");
      assert.equal(stripped.searchParams.get("utm_medium"), "share");
      assert.equal(stripped.searchParams.get("utm_campaign"), "person_profile");
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previous });
    }
  });
});

describe("goal invite show rules", () => {
  const base = {
    signedIn: true,
    userId: "user-a",
    flippedThisSession: true,
    goalDone: true,
    dismissed: false,
    lastShownAt: null as number | null,
    now: NOW,
    alreadyOpen: false,
  };

  it("opens on a session flip and stays open after the stamp", () => {
    assert.equal(goalInviteOpen(base), true);
    assert.equal(goalInviteOpen({ ...base, alreadyOpen: true, lastShownAt: NOW }), true);
  });

  it("stays closed when the page loads with the goal already done", () => {
    assert.equal(goalInviteOpen({ ...base, flippedThisSession: false }), false);
    assert.equal(goalInviteOpen({ ...base, goalDone: false }), false);
    assert.equal(goalInviteOpen({ ...base, signedIn: false }), false);
    assert.equal(goalInviteOpen({ ...base, userId: null }), false);
  });

  it("shows at most once per 7 days", () => {
    assert.equal(goalInviteOpen({ ...base, lastShownAt: NOW - WEEK + 1 }), false);
    assert.equal(goalInviteOpen({ ...base, lastShownAt: NOW - WEEK }), true);
    assert.equal(goalInviteOpen({ ...base, lastShownAt: NOW - WEEK - 1 }), true);
  });

  it("hides permanently after dismiss, including a later flip", () => {
    assert.equal(goalInviteOpen({ ...base, dismissed: true }), false);
    assert.equal(goalInviteOpen({ ...base, dismissed: true, alreadyOpen: true, lastShownAt: null }), false);
  });

  it("keeps the stamp and the dismiss flag per user", () => {
    const storage = memoryStorage();
    writeGoalInviteShownAt(storage, "user-a", NOW);
    writeGoalInviteDismissed(storage, "user-a");
    assert.equal(readGoalInviteShownAt(storage, "user-a"), NOW);
    assert.equal(readGoalInviteDismissed(storage, "user-a"), true);
    assert.equal(readGoalInviteShownAt(storage, "user-b"), null);
    assert.equal(readGoalInviteDismissed(storage, "user-b"), false);
    assert.equal(storage.dump.has(goalInviteShownKey("user-b")), false);
    assert.equal(storage.dump.has(goalInviteDismissedKey("user-b")), false);
    assert.notEqual(goalInviteShownKey("user-a"), goalInviteShownKey("user-b"));
    assert.notEqual(goalInviteDismissedKey("user-a"), goalInviteDismissedKey("user-b"));
  });
});

describe("invite reward copy", () => {
  it("uses the Refer a Friend sentence and the configured amounts", () => {
    const amounts = referralRewardAmounts();
    const completed = CREDIT_ACTIONS.find((action) => action.key === "referral_completed");
    const bonus = CREDIT_ACTIONS.find((action) => action.key === "referral_signup_bonus");
    assert.ok(completed);
    assert.ok(bonus);
    assert.equal(amounts.referrerReward, completed.proposedCredits);
    assert.equal(amounts.signupBonus, bonus.proposedCredits);
    assert.match(referralRewardSentence(), new RegExp(voxWord(amounts.referrerReward)));
    assert.match(referralRewardSentence(), new RegExp(voxWord(amounts.friendStart)));
    assert.equal(goalDoneInviteCopy(), `Nice, goal done. Invite a friend: ${referralRewardSentence()}`);
  });
});

describe("one accessible returning-user strip", () => {
  const strip = readFileSync(
    new URL("../client/src/components/vote/ReturningUserStrip.tsx", import.meta.url),
    "utf8",
  );
  const goalMark = readFileSync(
    new URL("../client/src/components/vote/DailyGoalMark.tsx", import.meta.url),
    "utf8",
  );
  const crowd = readFileSync(new URL("../client/src/components/vote/CrowdLine.tsx", import.meta.url), "utf8");
  const rating = readFileSync(new URL("../client/src/components/OverallRatingCard.tsx", import.meta.url), "utf8");
  const sheet = readFileSync(
    new URL("../client/src/components/vote/ResolvedPredictionsSheet.tsx", import.meta.url),
    "utf8",
  );

  it("exposes a single goal test id and hides the width probes", () => {
    assert.equal((strip.match(/data-testid=\{interactive \? "vote-return-strip-goal"/g) ?? []).length, 1);
    assert.equal((goalMark.match(/vote-return-strip-goal-ring/g) ?? []).length, 1);
    assert.match(goalMark, /exposed \? "vote-return-strip-goal-ring"/);
    assert.match(strip, /aria-hidden="true"/);
    assert.match(strip, /node\.inert = true/);
    assert.match(strip, /data-strip-measure/);
    assert.match(strip, /exposed=\{interactive\}/);
    const measureAt = strip.indexOf("data-strip-measure");
    const visibleGoal = strip.indexOf('data-testid={interactive ? "vote-return-strip-goal"');
    assert.ok(measureAt > visibleGoal);
    assert.equal(strip.slice(measureAt).includes("vote-return-strip-resolved\""), false);
  });

  it("keeps the share icon on the crowd line and leaves Share Win alone", () => {
    assert.match(crowd, /h-5/);
    assert.match(crowd, /before:h-8 before:w-8/);
    assert.match(crowd, /aria-label=\{label\}/);
    assert.match(sheet, /Share Win/);
    assert.equal(rating.includes("share="), false);
  });
});
