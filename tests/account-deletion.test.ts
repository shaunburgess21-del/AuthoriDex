import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ACCOUNT_STATE_TABLES,
  DELETION_WINDOW_MS,
  DELETED_AUTHOR_LABEL,
  DELETED_COMMENT_BODY,
  applyErasurePlan,
  buildAnonymisedProfilePatch,
  classifyAuthDeleteError,
  collectProfileIdentifiers,
  formatAnonymisedUsername,
  isErasureStarted,
  isOverdue,
  isPublicProfileUnavailable,
  planDeletionCancel,
  planDeletionRequest,
  presentPublicAuthor,
  scrubBetMetadata,
  scrubIdentifyingJson,
  shouldRejectSignIn,
  shouldStampDeletedAt,
  suggestionNameAfterErasure,
  type ErasureWorld,
} from "../server/services/account-deletion-utils";
import { performPermanentDeletion } from "../server/services/account-deletion-execute";
import { isNewUserGateAllowlisted } from "../shared/public-paths";
import {
  DELETE_ACCOUNT_DIALOG_PARAGRAPHS,
  DELETE_ACCOUNT_SETTINGS_SUMMARY,
} from "../shared/account-deletion-copy";

// Pure-helper tests for the account-deletion sweeper predicate.
// The live DB-reading shell mirrors this predicate in its WHERE
// clause (`scheduled_for <= NOW() AND deleted_at IS NULL`); pinning
// the decision logic here keeps the live SQL honest without needing
// test DB scaffolding.

test("DELETION_WINDOW_MS equals 7 days", () => {
  assert.equal(DELETION_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
});

test("isOverdue: null scheduledFor → false (no deletion pending)", () => {
  const result = isOverdue({
    now: new Date("2026-05-18T12:00:00Z"),
    scheduledFor: null,
    deletedAt: null,
  });
  assert.equal(result, false);
});

test("isOverdue: future scheduledFor → false (still in the window)", () => {
  const result = isOverdue({
    now: new Date("2026-05-18T12:00:00Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: null,
  });
  assert.equal(result, false);
});

test("isOverdue: past scheduledFor → true (window elapsed)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:01Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: null,
  });
  assert.equal(result, true);
});

test("isOverdue: exactly-at scheduledFor → true (>= is inclusive)", () => {
  const t = new Date("2026-05-25T12:00:00Z");
  const result = isOverdue({
    now: t,
    scheduledFor: t,
    deletedAt: null,
  });
  assert.equal(result, true);
});

test("isOverdue: deletedAt already set → false (skip already-finalised rows)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:00Z"),
    scheduledFor: new Date("2026-05-25T12:00:00Z"),
    deletedAt: new Date("2026-05-25T12:00:00Z"),
  });
  assert.equal(result, false);
});

test("isOverdue: scheduledFor in the future + deletedAt set → false (defensive: never finalise twice)", () => {
  const result = isOverdue({
    now: new Date("2026-05-25T12:00:00Z"),
    scheduledFor: new Date("2026-06-25T12:00:00Z"),
    deletedAt: new Date("2026-05-25T12:00:00Z"),
  });
  assert.equal(result, false);
});

test("isOverdue: a typical 7-day request matures correctly", () => {
  const requestedAt = new Date("2026-05-18T12:00:00Z");
  const scheduledFor = new Date(requestedAt.getTime() + DELETION_WINDOW_MS);
  // One minute before the window closes → not overdue.
  const notYet = isOverdue({
    now: new Date(scheduledFor.getTime() - 60_000),
    scheduledFor,
    deletedAt: null,
  });
  assert.equal(notYet, false);
  // One minute after the window closes → overdue.
  const now = isOverdue({
    now: new Date(scheduledFor.getTime() + 60_000),
    scheduledFor,
    deletedAt: null,
  });
  assert.equal(now, true);
});

const NOW = new Date("2026-05-18T12:00:00Z");

function activeProfile() {
  return {
    role: "user",
    username: "ada",
    requestedAt: null,
    scheduledFor: null,
    deletedAt: null,
    isAgent: false,
    isHouse: false,
  };
}

test("scheduling: a new request is 7 days out and the account stays active", () => {
  const plan = planDeletionRequest(activeProfile(), NOW);
  assert.equal(plan.kind, "schedule");
  if (plan.kind !== "schedule") return;
  assert.equal(plan.scheduledFor.getTime() - plan.requestedAt.getTime(), DELETION_WINDOW_MS);
  assert.equal(shouldRejectSignIn({ username: "ada", deletedAt: null }), false);
  assert.equal(
    planDeletionCancel({ ...activeProfile(), requestedAt: plan.requestedAt, scheduledFor: plan.scheduledFor }).kind,
    "cancel",
  );
});

test("scheduling: a second request does not reset the clock", () => {
  const requestedAt = NOW;
  const scheduledFor = new Date(NOW.getTime() + DELETION_WINDOW_MS);
  const plan = planDeletionRequest(
    { ...activeProfile(), requestedAt, scheduledFor },
    new Date(NOW.getTime() + 60_000),
  );
  assert.deepEqual(plan, { kind: "already_pending", requestedAt, scheduledFor });
});

test("scheduling: admins and already-finalised accounts are refused", () => {
  assert.equal(planDeletionRequest({ ...activeProfile(), role: "admin" }, NOW).kind, "reject");
  const finalised = planDeletionRequest(
    { ...activeProfile(), deletedAt: NOW, requestedAt: NOW, scheduledFor: NOW },
    NOW,
  );
  assert.equal(finalised.kind, "reject");
  if (finalised.kind === "reject") assert.equal(finalised.error, "already_finalised");
});

test("cancellation closes once erasure has started", () => {
  const username = formatAnonymisedUsername("a".repeat(32));
  const profile = {
    ...activeProfile(),
    username,
    requestedAt: NOW,
    scheduledFor: new Date(NOW.getTime() + DELETION_WINDOW_MS),
  };
  assert.equal(isErasureStarted(profile), true);
  const plan = planDeletionCancel(profile);
  assert.equal(plan.kind, "reject");
  if (plan.kind === "reject") assert.equal(plan.error, "erasure_started");
  assert.equal(shouldRejectSignIn(profile), true);
  assert.equal(isPublicProfileUnavailable(profile), true);
});

test("sign-in still works during the 7-day window", () => {
  assert.equal(shouldRejectSignIn({ username: "ada", deletedAt: null }), false);
  assert.equal(isPublicProfileUnavailable({ username: "ada", deletedAt: null }), false);
});

test("public profile is unavailable after deletedAt, even if the username were unchanged", () => {
  assert.equal(
    isPublicProfileUnavailable({ username: "ada", deletedAt: NOW }),
    true,
  );
});

test("Auth deletion: 404 counts as success and does not stamp on other failures", () => {
  assert.equal(classifyAuthDeleteError(null), "deleted");
  assert.equal(classifyAuthDeleteError({ status: 404, message: "User not found" }), "already_missing");
  assert.equal(classifyAuthDeleteError({ message: "User not found" }), "already_missing");
  assert.equal(classifyAuthDeleteError({ status: 500, message: "database unavailable" }), "failed");
  assert.equal(shouldStampDeletedAt("deleted"), true);
  assert.equal(shouldStampDeletedAt("already_missing"), true);
  assert.equal(shouldStampDeletedAt("failed"), false);
});

test("permanent execution deletes Auth before stamping deletedAt", async () => {
  const calls: string[] = [];
  const outcome = await performPermanentDeletion({
    userId: "user-1",
    now: NOW,
    loadCandidate: async () => ({
      id: "user-1",
      role: "user",
      username: "ada",
      deletedAt: null,
      protectedAccount: false,
    }),
    erasePersonalData: async () => {
      calls.push("erase");
    },
    deleteAuthUser: async () => {
      calls.push("auth");
      return { error: null };
    },
    stampDeletedAt: async () => {
      calls.push("stamp");
    },
  });
  assert.deepEqual(calls, ["erase", "auth", "stamp"]);
  assert.deepEqual(outcome, { outcome: "finalised", auth: "deleted" });
});

test("permanent execution does not stamp deletedAt when Auth deletion fails", async () => {
  let stamped = false;
  const outcome = await performPermanentDeletion({
    userId: "user-1",
    now: NOW,
    loadCandidate: async () => ({
      id: "user-1",
      role: "user",
      username: "ada",
      deletedAt: null,
      protectedAccount: false,
    }),
    erasePersonalData: async () => {},
    deleteAuthUser: async () => ({ error: { status: 500, message: "boom" } }),
    stampDeletedAt: async () => {
      stamped = true;
    },
  });
  assert.equal(stamped, false);
  assert.equal(outcome.outcome, "auth_failed");
});

test("permanent execution treats a missing Auth user as success", async () => {
  const outcome = await performPermanentDeletion({
    userId: "user-1",
    now: NOW,
    loadCandidate: async () => ({
      id: "user-1",
      role: "user",
      username: formatAnonymisedUsername("b".repeat(32)),
      deletedAt: null,
      protectedAccount: false,
    }),
    erasePersonalData: async () => {
      throw new Error("erasure already started; must not run again");
    },
    deleteAuthUser: async () => ({ error: { status: 404, message: "User not found" } }),
    stampDeletedAt: async () => {},
  });
  assert.deepEqual(outcome, { outcome: "finalised", auth: "already_missing" });
});

test("permanent execution does not call Auth for a protected account", async () => {
  let authCalled = false;
  const outcome = await performPermanentDeletion({
    userId: "user-1",
    now: NOW,
    loadCandidate: async () => ({
      id: "user-1",
      role: "admin",
      username: "ada",
      deletedAt: null,
      protectedAccount: true,
    }),
    erasePersonalData: async () => {
      throw new Error("must not erase");
    },
    deleteAuthUser: async () => {
      authCalled = true;
      return { error: null };
    },
    stampDeletedAt: async () => {
      throw new Error("must not stamp");
    },
  });
  assert.equal(authCalled, false);
  assert.equal(outcome.outcome, "skipped_protected");
});

test("profile anonymisation clears direct identifiers and does not stamp deletedAt", () => {
  const username = formatAnonymisedUsername("c".repeat(32));
  const patch = buildAnonymisedProfilePatch(username);
  assert.equal(patch.username, username);
  assert.equal(patch.bio, null);
  assert.equal(patch.avatarUrl, null);
  assert.equal(patch.dateOfBirth, null);
  assert.equal(patch.recoveryEmail, null);
  assert.equal(patch.phoneNumber, null);
  assert.equal(patch.socialXHandle, null);
  assert.equal(patch.referralCode, null);
  assert.equal(patch.predictCredits, 0);
  assert.equal(patch.xpPoints, 0);
  assert.equal(patch.currentStreak, 0);
  assert.equal(patch.statedInterests && Array.isArray(patch.statedInterests) && patch.statedInterests.length, 0);
  assert.equal(patch.isPublic, false);
  assert.equal("deletedAt" in patch, false);
});

function sampleWorld(): ErasureWorld {
  return {
    profile: {
      id: "user-1",
      username: "ada",
      fullName: "Ada Lovelace",
      bio: "secret bio",
      recoveryEmail: "ada@example.com",
      phoneNumber: "+27110000000",
      referralCode: "VXADA123",
      predictCredits: 500,
      xpPoints: 40,
      currentStreak: 3,
      avatarUrl: "https://cdn.example/ada.png",
      deletedAt: null,
      isPublic: true,
    },
    comments: [
      { id: "c1", userId: "user-1", body: "I am ada and this is my take" },
      { id: "c2", userId: "user-2", body: "a reply that should stay" },
    ],
    votes: [{ id: "v1", userId: "user-1", choice: "up" }],
    predictions: [{
      id: "b1",
      userId: "user-1",
      stake: 25,
      betMetadata: {
        predictedScore: 88,
        rationale: "ada@example.com thinks this rips",
        username: "ada",
      },
    }],
    ledger: [{
      id: "l1",
      userId: "user-1",
      amount: -25,
      metadata: { marketId: "m1", email: "ada@example.com", ipAddress: "203.0.113.5" },
    }],
    xp: [{ id: "x1", userId: "user-1" }],
    preferences: [{ userId: "user-1" }],
    suggestions: [
      { id: "s1", suggestedBy: "user-1", name: "Add a jazz category" },
      { id: "s2", suggestedBy: "user-1", name: "ada" },
    ],
    audit: [{
      id: "a1",
      targetId: "user-1",
      adminId: "user-1",
      adminEmail: "ada@example.com",
      previousData: { username: "ada", role: "user" },
      metadata: { ipAddress: "203.0.113.5", userAgent: "TestBrowser" },
    }],
    telemetry: [{
      id: "t1",
      userId: "user-1",
      userAgent: "TestBrowser",
      metadata: { email: "ada@example.com" },
    }],
  };
}

test("erasure keeps historical records but they no longer identify the user", () => {
  const identifiers = collectProfileIdentifiers(
    { username: "ada", fullName: "Ada Lovelace", recoveryEmail: "ada@example.com", referralCode: "VXADA123" },
    "ada@example.com",
  );
  const next = applyErasurePlan(sampleWorld(), {
    anonymousUsername: formatAnonymisedUsername("d".repeat(32)),
    identifiers,
  });

  assert.equal(next.votes.length, 1);
  assert.equal(next.votes[0].userId, "user-1");
  assert.equal(next.votes[0].choice, "up");
  assert.equal(next.predictions.length, 1);
  assert.equal(next.predictions[0].stake, 25);
  assert.deepEqual(next.predictions[0].betMetadata, { predictedScore: 88 });
  assert.equal(next.ledger.length, 1);
  assert.equal(next.ledger[0].amount, -25);
  assert.deepEqual(next.ledger[0].metadata, { marketId: "m1" });
  assert.equal(next.profile.deletedAt, null);
  assert.equal(next.profile.bio, null);
  assert.equal(next.profile.predictCredits, 0);
  assert.equal(isPublicProfileUnavailable(next.profile), true);
  assert.equal(next.comments[0].body, DELETED_COMMENT_BODY);
  assert.equal(next.comments[1].body, "a reply that should stay");
  assert.equal(next.suggestions[0].name, "Add a jazz category");
  assert.equal(next.suggestions[1].name, DELETED_COMMENT_BODY);
  assert.equal(next.xp.length, 0);
  assert.equal(next.preferences.length, 0);
  assert.equal(next.audit[0].adminEmail, null);
  assert.deepEqual(next.audit[0].previousData, { role: "user" });
  assert.equal(next.telemetry[0].userId, null);
  assert.equal(next.telemetry[0].userAgent, null);
  const author = presentPublicAuthor({
    username: next.profile.username,
    avatarUrl: next.profile.avatarUrl,
    rank: "Citizen",
  });
  assert.equal(author.deleted, true);
  assert.equal(author.username, DELETED_AUTHOR_LABEL);
  assert.equal(author.avatarUrl, null);
});

test("account-state cleanup covers xp, preferences, referrals-adjacent rows, and tokens", () => {
  for (const table of [
    "xp_ledger",
    "user_badges",
    "user_category_engagement",
    "profile_item_privacy",
    "notification_preferences",
    "notifications",
    "email_unsubscribe_state",
    "user_favourites",
  ]) {
    assert.equal(ACCOUNT_STATE_TABLES.includes(table as (typeof ACCOUNT_STATE_TABLES)[number]), true);
  }
  assert.equal((ACCOUNT_STATE_TABLES as readonly string[]).includes("market_bets"), false);
});

test("suggestion text that is an option is kept; a name that is the person is cleared", () => {
  const ids = ["ada", "Ada Lovelace"];
  assert.equal(suggestionNameAfterErasure("Taylor Swift", ids), "Taylor Swift");
  assert.equal(suggestionNameAfterErasure("Ada Lovelace", ids), DELETED_COMMENT_BODY);
});

test("ledger scrub drops identity and keeps the engineering amount context", () => {
  const scrubbed = scrubIdentifyingJson(
    { marketId: "m1", email: "ada@example.com", username: "ada", note: "stake" },
    ["ada", "ada@example.com"],
  );
  assert.deepEqual(scrubbed, { marketId: "m1", note: "stake" });
  assert.deepEqual(
    scrubBetMetadata({ predictedScore: 10, thesis: "hello ada", email: "ada@example.com" }, ["ada"]),
    { predictedScore: 10 },
  );
});

test("/account-deletion is public and on the new-user allowlist", () => {
  assert.equal(isNewUserGateAllowlisted("/account-deletion"), true);
  const root = path.resolve(".");
  const app = fs.readFileSync(path.join(root, "client/src/App.tsx"), "utf8");
  assert.match(app, /path="\/account-deletion"/);
  const page = fs.readFileSync(path.join(root, "client/src/pages/AccountDeletionPage.tsx"), "utf8");
  assert.doesNotMatch(page, /requireAuth/);
  const copy = fs.readFileSync(path.join(root, "legal/account-deletion.md"), "utf8");
  assert.match(copy, /legal@voxdex\.com/);
  assert.match(copy, /7 days/);
  assert.match(copy, /stays active/);
  assert.match(copy, /\[deleted\]/);
  assert.match(copy, /60 days/);
  assert.match(copy, /\/privacy/);
  assert.match(copy, /Me → Settings → Account → Delete Account/);
  assert.doesNotMatch(copy, /7 years/);
});

test("privacy policy and terms match the deletion behaviour", () => {
  const root = path.resolve(".");
  const privacy = fs.readFileSync(path.join(root, "legal/privacy-policy.md"), "utf8");
  const terms = fs.readFileSync(path.join(root, "legal/terms-of-service.md"), "utf8");
  assert.doesNotMatch(privacy, /7 years/);
  assert.doesNotMatch(privacy, /tax and accounting/);
  assert.match(privacy, /engineering audit log/);
  assert.match(privacy, /60 days/);
  assert.match(privacy, /7 days/);
  assert.match(privacy, /legal@voxdex\.com/);
  assert.match(privacy, /\/account-deletion/);
  const section15 = terms.split("## 16.")[0]?.split("## 15. Termination")[1] ?? "";
  assert.match(section15, /legal@voxdex\.com/);
  assert.doesNotMatch(section15, /hello@voxdex\.com/);
  assert.match(terms, /hello@voxdex\.com/);
  assert.match(DELETE_ACCOUNT_SETTINGS_SUMMARY, /7 days/);
  assert.doesNotMatch(DELETE_ACCOUNT_SETTINGS_SUMMARY, /Permanently delete your account and all data/);
  assert.match(DELETE_ACCOUNT_DIALOG_PARAGRAPHS.join(" "), /not permanently deleted during this window/);
  assert.match(DELETE_ACCOUNT_DIALOG_PARAGRAPHS.join(" "), /placeholder/);
});
