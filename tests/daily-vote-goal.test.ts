import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DAILY_VOTE_GOAL,
  STREAK_ENDS_TONIGHT_LABEL,
  appendOptimisticMeVote,
  countMeVotesOnStreakDay,
  countVotesOnStreakDay,
  createdAtsFromMeVotes,
  dailyGoalCopy,
  isDailyGoalVoteRequest,
  mostRecentLocalClockMs,
  nextUtcMidnightMs,
  streakChipLabel,
  streakDayKey,
  streakReminderActive,
} from "../client/src/lib/dailyVoteGoal";

const strip = readFileSync(
  new URL("../client/src/components/vote/ReturningUserStrip.tsx", import.meta.url),
  "utf8",
);
const goalMark = readFileSync(
  new URL("../client/src/components/vote/DailyGoalMark.tsx", import.meta.url),
  "utf8",
);
const apiRequest = readFileSync(new URL("../client/src/lib/queryClient.ts", import.meta.url), "utf8");
const goalLib = readFileSync(new URL("../client/src/lib/dailyVoteGoal.ts", import.meta.url), "utf8");

describe("daily vote goal count uses the streak's UTC day", () => {
  it("keys the day the same way as utcDateString", () => {
    const now = new Date("2026-11-23T23:30:00.000Z");
    assert.equal(streakDayKey(now), now.toISOString().split("T")[0]);
    assert.equal(streakDayKey(new Date("2026-11-24T00:00:00.000Z")), "2026-11-24");
  });

  it("counts only ballots on the current UTC day", () => {
    const now = new Date("2026-11-23T21:00:00.000Z");
    const rows = [
      "2026-11-23T00:00:00.000Z",
      "2026-11-23T18:15:00.000Z",
      "2026-11-22T23:59:59.000Z",
      "not-a-date",
      "",
    ];
    assert.equal(countVotesOnStreakDay(rows, now), 2);
    assert.equal(countVotesOnStreakDay(["2026-11-24T00:00:00.000Z"], now), 0);
  });

  it("does not treat a western local evening as the same day as the previous UTC date", () => {
    // 20:00 in Los Angeles is already the next UTC date.
    const now = new Date("2026-11-23T20:00:00-08:00");
    assert.equal(now.toISOString(), "2026-11-24T04:00:00.000Z");
    assert.equal(streakDayKey(now), "2026-11-24");
    const count = countMeVotesOnStreakDay(
      [
        { createdAt: "2026-11-23T23:30:00.000Z", voteType: "face_off" },
        { createdAt: "2026-11-24T00:10:00.000Z", voteType: "trending_poll" },
        { createdAt: "2026-11-24T03:00:00.000Z", voteType: "induction" },
        { voteType: "face_off" },
        null,
      ],
      now,
    );
    assert.equal(count, 2);
  });

  it("reads createdAt from the me/votes array and ignores other shapes", () => {
    const now = new Date("2026-11-23T12:00:00.000Z");
    assert.deepEqual(createdAtsFromMeVotes({ predictions: [] }), []);
    assert.deepEqual(createdAtsFromMeVotes(null), []);
    const parsed = createdAtsFromMeVotes([
      { createdAt: "2026-11-23T01:00:00.000Z" },
      { createdAt: Date.parse("2026-11-23T02:00:00.000Z") },
      { id: "missing" },
      "nope",
    ]);
    assert.equal(parsed.length, 2);
    assert.equal(countVotesOnStreakDay(parsed, now), 2);
  });

  it("moves the count on an optimistic append and lets the server payload replace it", () => {
    const now = new Date("2026-11-23T18:00:00.000Z");
    const server = [{ createdAt: "2026-11-23T12:00:00.000Z", voteType: "face_off" }];
    assert.equal(countMeVotesOnStreakDay(server, now), 1);
    const optimistic = appendOptimisticMeVote(server, now);
    assert.equal(countMeVotesOnStreakDay(optimistic, now), 2);
    const reconciled = [
      { createdAt: "2026-11-23T12:00:00.000Z" },
      { createdAt: "2026-11-23T18:00:01.000Z" },
    ];
    assert.equal(countMeVotesOnStreakDay(reconciled, now), 2);
    // A changed ballot stays one row. The refetch settles the extra optimistic row.
    assert.equal(countMeVotesOnStreakDay([{ createdAt: "2026-11-23T18:00:01.000Z" }], now), 1);
    assert.equal(countMeVotesOnStreakDay(appendOptimisticMeVote(undefined, now), now), 1);
  });
});

describe("daily goal copy", () => {
  it("names the in-progress count and the done state", () => {
    const two = dailyGoalCopy(2);
    assert.equal(two.done, false);
    assert.equal(two.full, "2 of 5 votes today");
    assert.equal(two.ariaLabel, "Daily goal: 2 of 5 votes today");
    assert.equal(two.mid, "2 of 5");
    assert.equal(two.tight, "2/5");

    const zero = dailyGoalCopy(0);
    assert.equal(zero.full, "0 of 5 votes today");
    assert.equal(zero.ariaLabel, "Daily goal: 0 of 5 votes today");

    const done = dailyGoalCopy(DAILY_VOTE_GOAL);
    assert.equal(done.done, true);
    assert.equal(done.full, "Goal done, streak safe");
    assert.equal(done.mid, "Goal done");
    assert.equal(done.tight, "Done");
    assert.equal(done.ariaLabel, "Daily goal: done, streak safe");
    assert.equal(dailyGoalCopy(8).done, true);
    assert.equal(dailyGoalCopy(Number.NaN).full, "0 of 5 votes today");
  });
});

describe("streak reminder timing", () => {
  const la = "America/Los_Angeles";
  const johannesburg = "Africa/Johannesburg";

  function active(iso: string, timeZone: string, streak = 4, votesToday = 0): boolean {
    return streakReminderActive({ now: new Date(iso), timeZone, streak, votesToday });
  }

  it("turns amber from 18:00 UTC until the UTC cutoff, and off at midnight", () => {
    assert.equal(active("2026-11-23T17:59:00.000Z", "UTC"), false);
    assert.equal(active("2026-11-23T18:00:00.000Z", "UTC"), true);
    assert.equal(active("2026-11-23T23:30:00.000Z", "UTC"), true);
    assert.equal(active("2026-11-24T00:00:00.000Z", "UTC"), false);
    assert.equal(nextUtcMidnightMs(new Date("2026-11-23T18:00:00.000Z")), Date.parse("2026-11-24T00:00:00.000Z"));
    assert.equal(nextUtcMidnightMs(new Date("2026-11-24T00:00:00.000Z")), Date.parse("2026-11-25T00:00:00.000Z"));
  });

  it("warns a western-hemisphere user before 18:00 local and stays quiet after the UTC cutoff", () => {
    // PST (UTC-8) in November. UTC midnight is 16:00 local.
    assert.equal(active("2026-11-23T09:00:00-08:00", la), false);
    // Exactly 6 hours out is not yet "less than 6 hours".
    assert.equal(active("2026-11-23T10:00:00-08:00", la), false);
    assert.equal(active("2026-11-23T10:01:00-08:00", la), true);
    assert.equal(active("2026-11-23T15:00:00-08:00", la), true);
    assert.equal(active("2026-11-23T15:59:00-08:00", la), true);
    // 16:00 local is the cutoff. 18:00 local is after it, so the chip stays off.
    assert.equal(active("2026-11-23T16:00:00-08:00", la), false);
    assert.equal(active("2026-11-23T18:00:00-08:00", la), false);
    assert.equal(active("2026-11-23T22:30:00-08:00", la), false);
    // PDT (UTC-7). Cutoff is 17:00 local; 18:00 is still after it.
    assert.equal(active("2026-07-15T14:00:00-07:00", la), true);
    assert.equal(active("2026-07-15T18:00:00-07:00", la), false);
  });

  it("keeps the reminder through local midnight in South Africa until 02:00", () => {
    assert.equal(active("2026-11-23T17:59:00+02:00", johannesburg), false);
    assert.equal(active("2026-11-23T18:00:00+02:00", johannesburg), true);
    assert.equal(active("2026-11-23T23:30:00+02:00", johannesburg), true);
    assert.equal(active("2026-11-24T01:30:00+02:00", johannesburg), true);
    assert.equal(active("2026-11-24T02:00:00+02:00", johannesburg), false);
    assert.equal(active("2026-11-24T03:00:00+02:00", johannesburg), false);
  });

  it("clears on the first vote today and stays off without a streak", () => {
    assert.equal(active("2026-11-23T21:00:00.000Z", "UTC", 4, 1), false);
    assert.equal(active("2026-11-23T21:00:00.000Z", "UTC", 1, 0), true);
    assert.equal(active("2026-11-23T21:00:00.000Z", "UTC", 0, 0), false);
    assert.equal(active("2026-11-23T15:00:00-08:00", la, 3, 1), false);
    assert.equal(streakChipLabel(4, true), STREAK_ENDS_TONIGHT_LABEL);
    assert.equal(streakChipLabel(4, false), "4-day streak");
    assert.equal(streakChipLabel(0, false), "Start a streak today");
  });

  it("resolves local 18:00 in Los Angeles to the matching UTC instant", () => {
    const atSix = mostRecentLocalClockMs(new Date("2026-11-23T18:00:00-08:00"), la, 18, 0);
    assert.equal(new Date(atSix ?? 0).toISOString(), "2026-11-24T02:00:00.000Z");
    const before = mostRecentLocalClockMs(new Date("2026-11-23T10:00:00-08:00"), la, 18, 0);
    assert.equal(new Date(before ?? 0).toISOString(), "2026-11-23T02:00:00.000Z");
  });
});

describe("which requests count as a goal vote", () => {
  it("accepts signed-in vote casts and skips removals, comments, and admin routes", () => {
    assert.equal(isDailyGoalVoteRequest("POST", "/api/polls/slug/vote", { choice: "agree" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/matchups/m1/vote", { option: "option_a" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/matchups/m1/vote", { remove: true }), false);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/opinion-polls/slug/vote", { optionId: "a" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/opinion-polls/slug/vote", { remove: true }), false);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/vote/induction/c1/vote", undefined), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/people/p1/images/i1/vote", { direction: "up" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/celebrity/p1/approval-rating", { rating: 4 }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/celebrity/p1/value-vote", { vote: "underrated" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/sentiment-votes", { voteType: "over" }), true);
    assert.equal(isDailyGoalVoteRequest("POST", "/api/comments/c1/vote", { voteType: "up" }), false);
    assert.equal(
      isDailyGoalVoteRequest("POST", "/api/opinion-polls/slug/suggestions/s1/vote", { vote: 1 }),
      false,
    );
    assert.equal(isDailyGoalVoteRequest("POST", "/api/admin/agents/run-votes", {}), false);
    assert.equal(isDailyGoalVoteRequest("GET", "/api/me/votes", undefined), false);
    assert.equal(
      isDailyGoalVoteRequest("POST", "https://voxdex.com/api/polls/slug/vote?x=1", { choice: "neutral" }),
      true,
    );
  });
});

describe("strip wiring", () => {
  it("keeps the fixed row, the resolved stamp, and the goal in the reserved slot", () => {
    assert.match(strip, /h-11/);
    assert.match(strip, /shouldStampResolvedLastSeen\("results-sheet"\)/);
    assert.match(strip, /stampResolvedLastSeenAt/);
    assert.match(strip, /vote-return-strip-goal-slot/);
    assert.match(strip, /aria-live=\{interactive \? "polite"/);
    assert.match(goalMark, /motion-reduce:transition-none/);
    assert.match(goalMark, /aria-label=\{label\}/);
    assert.match(goalLib, /Streak ends tonight/);
    assert.match(strip, /ME_VOTES_QUERY_KEY/);
    assert.match(goalLib, /\/api\/me\/votes/);
    assert.match(strip, /whitespace-nowrap/);
    assert.equal(strip.includes("visibilitychange"), false);
    assert.match(apiRequest, /isDailyGoalVoteRequest/);
    assert.match(apiRequest, /noteOptimisticDailyVote/);
  });
});
