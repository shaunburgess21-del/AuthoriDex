import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { authLoginPath } from "../client/src/lib/authReturn";
import {
  anonNudgePlacement,
  anonNudgeReservesSpace,
  isAuthSurfaceRoute,
  isVoteChecklistRoute,
  welcomeChecklistSuppressesAnonNudge,
} from "../client/src/lib/anonFirstVoteNudge";
import {
  SIGNUP_GENERIC_DESCRIPTION,
  SIGNUP_GENERIC_TITLE,
  parseAuthReason,
  signupFormCopy,
} from "../client/src/lib/signupReasonCopy";
import {
  WELCOME_ALL_SET_LABEL,
  WELCOME_CHECKLIST_HEADLINE,
  WELCOME_DEVICE_DISMISS_KEY,
  WELCOME_HOW_IT_WORKS_HREF,
  WELCOME_HOW_IT_WORKS_LABEL,
  WELCOME_STEPS,
  favoriteListHasPerson,
  firstUnvotedFeedKey,
  pickFirstVisibleUnvoted,
  predictionListHasRow,
  profileProvesPartial,
  readWelcomeComplete,
  readWelcomeDeviceDismissed,
  readWelcomeOpen,
  subscribeWelcomeDeviceDismiss,
  readWelcomeUserDismissed,
  returningStripAllowed,
  voteListHasBallot,
  WELCOME_ACCOUNT_GATE_LABEL,
  WELCOME_FREE_ACCOUNT_HINT,
  WELCOME_JOIN_FREE_LABEL,
  WELCOME_SIGNED_OUT_NUDGE,
  anonBudgetProvesVote,
  welcomeChecklistPhase,
  welcomeCompleteKey,
  welcomeDoneCount,
  welcomeOpenKey,
  welcomeProgressLabel,
  welcomeStepNeedsAccount,
  welcomeUserDismissKey,
  writeWelcomeComplete,
  writeWelcomeDeviceDismissed,
  writeWelcomeOpen,
  writeWelcomeUserDismissed,
  isQuickVoteEntryNudgeAllowed,
  quickVoteEntryNudgeInput,
  type WelcomePhaseInput,
  type WelcomeStorage,
} from "../client/src/lib/welcomeChecklist";

const votePage = readFileSync(new URL("../client/src/pages/VotePage.tsx", import.meta.url), "utf8");
const checklist = readFileSync(
  new URL("../client/src/components/vote/WelcomeChecklist.tsx", import.meta.url),
  "utf8",
);
const howItWorks = readFileSync(
  new URL("../client/src/components/HowItWorksWelcomeModal.tsx", import.meta.url),
  "utf8",
);
const howItWorksPage = readFileSync(
  new URL("../client/src/pages/HowItWorksPage.tsx", import.meta.url),
  "utf8",
);

function memory(initial: Record<string, string> = {}): WelcomeStorage & { snapshot(): Record<string, string> } {
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

function throwingStorage(): WelcomeStorage {
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

function phase(overrides: Partial<WelcomePhaseInput> = {}) {
  const base: WelcomePhaseInput = {
    audienceKnown: true,
    signedIn: false,
    deviceDismissed: false,
    userDismissed: false,
    persistedComplete: false,
    persistedOpen: false,
    profileProvesPartial: false,
    hasVote: null,
    hasPrediction: null,
    hasFavorite: null,
    sawIncomplete: false,
  };
  return welcomeChecklistPhase({ ...base, ...overrides });
}

describe("welcome checklist visibility", () => {
  it("shows the card to a signed-out visitor", () => {
    assert.equal(phase(), "checklist");
    assert.equal(phase({ hasVote: true, hasPrediction: true, hasFavorite: true }), "checklist");
  });

  it("shows a signed-in visitor who has only finished some steps", () => {
    assert.equal(
      phase({
        signedIn: true,
        hasVote: true,
        hasPrediction: false,
        hasFavorite: false,
        sawIncomplete: true,
      }),
      "checklist",
    );
    assert.equal(
      phase({
        signedIn: true,
        hasVote: true,
        hasPrediction: true,
        hasFavorite: false,
        sawIncomplete: true,
      }),
      "checklist",
    );
    assert.equal(phase({ signedIn: true, profileProvesPartial: true }), "checklist");
    assert.equal(phase({ signedIn: true, persistedOpen: true }), "checklist");
  });

  it("shows You're all set only after the open card reaches 3 of 3", () => {
    assert.equal(
      phase({
        signedIn: true,
        hasVote: true,
        hasPrediction: true,
        hasFavorite: true,
        sawIncomplete: true,
      }),
      "all-set",
    );
  });

  it("hides an experienced visitor who already has a vote, a prediction, and a favorite", () => {
    assert.equal(
      phase({
        signedIn: true,
        hasVote: true,
        hasPrediction: true,
        hasFavorite: true,
        sawIncomplete: false,
        persistedOpen: true,
      }),
      "hidden",
    );
  });

  it("hides a dismissed visitor, including after a signed-out dismiss survives sign-in", () => {
    assert.equal(phase({ deviceDismissed: true }), "hidden");
    assert.equal(phase({ signedIn: true, deviceDismissed: true, profileProvesPartial: true }), "hidden");
    assert.equal(phase({ signedIn: true, userDismissed: true, profileProvesPartial: true }), "hidden");
    assert.equal(phase({ signedIn: true, persistedComplete: true, profileProvesPartial: true }), "hidden");
    assert.equal(phase({ audienceKnown: false, profileProvesPartial: true }), "hidden");
  });

  it("does not let another account's dismiss or completion hide this one", () => {
    assert.equal(phase({ signedIn: true, userDismissed: false, profileProvesPartial: true }), "checklist");
  });

  it("keeps the returning-user strip down while the checklist owns the slot", () => {
    assert.equal(returningStripAllowed(true, "checklist"), false);
    assert.equal(returningStripAllowed(true, "all-set"), false);
    assert.equal(returningStripAllowed(true, "hidden"), true);
    assert.equal(returningStripAllowed(false, "hidden"), false);
  });

  it("waits to show a signed-in visitor until a step is known to be open", () => {
    assert.equal(
      phase({
        signedIn: true,
        hasVote: null,
        hasPrediction: null,
        hasFavorite: null,
      }),
      "hidden",
    );
    assert.equal(phase({ signedIn: true, hasVote: false, hasPrediction: null, hasFavorite: null }), "checklist");
  });
});

describe("welcome checklist progress and payloads", () => {
  it("counts only confirmed ticks and labels them N of 3", () => {
    assert.equal(welcomeDoneCount({ hasVote: true, hasPrediction: null, hasFavorite: false }), 1);
    assert.equal(welcomeProgressLabel(1), "1 of 3");
    assert.equal(welcomeProgressLabel(3), "3 of 3");
    assert.equal(welcomeProgressLabel(9), "3 of 3");
    assert.equal(WELCOME_ALL_SET_LABEL, "You're all set");
    assert.equal(
      WELCOME_CHECKLIST_HEADLINE,
      "See what the world really thinks, and call what happens next.",
    );
    assert.deepEqual(
      WELCOME_STEPS.map((step) => step.label),
      ["Vote on a card", "Make a prediction", "Favorite someone"],
    );
  });

  it("reads votes, predictions, and favorites without inventing a tick", () => {
    assert.equal(voteListHasBallot([{ id: "a" }]), true);
    assert.equal(voteListHasBallot([]), false);
    assert.equal(voteListHasBallot({ votes: [] }), null);
    assert.equal(predictionListHasRow({ predictions: [{ betId: "b" }] }), true);
    assert.equal(predictionListHasRow({ predictions: [] }), false);
    assert.equal(predictionListHasRow([{ betId: "b" }]), true);
    assert.equal(predictionListHasRow({ stats: {} }), null);
    assert.equal(favoriteListHasPerson([{ celebrityId: "p" }]), true);
    assert.equal(favoriteListHasPerson([]), false);
    assert.equal(favoriteListHasPerson({ favorites: [{ celebrityId: "p" }] }), true);
    assert.equal(favoriteListHasPerson({ unexpected: true }), null);
    assert.equal(profileProvesPartial({ totalVotes: 0, totalPredictions: 4 }), true);
    assert.equal(profileProvesPartial({ totalVotes: 2, totalPredictions: 0 }), true);
    assert.equal(profileProvesPartial({ totalVotes: 2, totalPredictions: 1 }), false);
    assert.equal(profileProvesPartial(null), false);
  });

  it("picks the first visible unvoted card and the first unvoted feed key", () => {
    assert.equal(
      firstUnvotedFeedKey([
        { key: "matchup:1", voted: true },
        { key: "sentiment:2", voted: false },
      ]),
      "sentiment:2",
    );
    assert.equal(firstUnvotedFeedKey([{ key: "matchup:1", voted: true }]), null);
    const picked = pickFirstVisibleUnvoted([
      { id: "desktop-copy", unvoted: true, visible: false },
      { id: "mobile-copy", unvoted: true, visible: true },
    ]);
    assert.equal(picked?.id, "mobile-copy");
    assert.equal(
      pickFirstVisibleUnvoted([{ id: "voted", unvoted: false, visible: true }]),
      null,
    );
  });
});

describe("welcome checklist localStorage keys", () => {
  it("keys a signed-out dismiss on the device and a signed-in dismiss on the user id", () => {
    assert.equal(WELCOME_DEVICE_DISMISS_KEY, "voxdex_welcome_checklist_dismissed");
    assert.equal(welcomeUserDismissKey("user-a"), "voxdex_welcome_checklist_dismissed:user-a");
    assert.equal(welcomeCompleteKey("user-a"), "voxdex_welcome_checklist_complete:user-a");
    assert.equal(welcomeOpenKey("user-a"), "voxdex_welcome_checklist_open:user-a");
    assert.notEqual(welcomeUserDismissKey("user-a"), welcomeUserDismissKey("user-b"));

    const store = memory();
    writeWelcomeDeviceDismissed(store);
    writeWelcomeUserDismissed(store, "user-a");
    writeWelcomeOpen(store, "user-b");
    writeWelcomeComplete(store, "user-b");
    writeWelcomeOpen(store, "user-a");
    assert.equal(readWelcomeDeviceDismissed(store), true);
    assert.equal(readWelcomeUserDismissed(store, "user-a"), true);
    assert.equal(readWelcomeUserDismissed(store, "user-b"), false);
    assert.equal(readWelcomeComplete(store, "user-b"), true);
    assert.equal(readWelcomeComplete(store, "user-a"), false);
    assert.equal(readWelcomeOpen(store, "user-b"), false);
    assert.equal(readWelcomeOpen(store, "user-a"), true);
    assert.deepEqual(store.snapshot(), {
      [WELCOME_DEVICE_DISMISS_KEY]: "1",
      [welcomeUserDismissKey("user-a")]: "1",
      [welcomeCompleteKey("user-b")]: "1",
      [welcomeOpenKey("user-a")]: "1",
    });
  });

  it("keeps a signed-out dismiss in force after sign-in on the same device", () => {
    const store = memory();
    writeWelcomeDeviceDismissed(store);
    assert.equal(readWelcomeDeviceDismissed(store), true);
    assert.equal(
      phase({ signedIn: true, deviceDismissed: readWelcomeDeviceDismissed(store), profileProvesPartial: true }),
      "hidden",
    );
    assert.equal(readWelcomeUserDismissed(store, "user-a"), false);
  });

  it("ignores storage that throws", () => {
    const store = throwingStorage();
    assert.equal(readWelcomeDeviceDismissed(store), false);
    assert.equal(readWelcomeUserDismissed(store, "user-a"), false);
    assert.equal(readWelcomeComplete(store, "user-a"), false);
    assert.equal(readWelcomeOpen(store, "user-a"), false);
    assert.doesNotThrow(() => writeWelcomeDeviceDismissed(store));
    assert.doesNotThrow(() => writeWelcomeUserDismissed(store, "user-a"));
    assert.doesNotThrow(() => writeWelcomeComplete(store, "user-a"));
    assert.doesNotThrow(() => writeWelcomeOpen(store, "user-a"));
  });
});

describe("welcome checklist on the vote page", () => {
  it("replaces the auto toast with one checklist and leaves How it works alone", () => {
    assert.match(votePage, /<VoteWelcomeSlot onVote=\{scrollToFirstUnvoted\} \/>/);
    assert.equal(votePage.includes("<ReturningUserStrip />"), false);
    assert.match(votePage, /disableAutoToast\s*\n/);
    assert.equal(votePage.includes('toastLabel="New to voting?"'), true);
    assert.equal((checklist.match(/data-testid="vote-welcome-checklist"/g) ?? []).length, 1);
    assert.equal(checklist.includes("md:hidden"), false);
    assert.equal(checklist.includes("hidden md:"), false);
    assert.match(checklist, /aria-checked=\{isDone\}/);
    assert.match(checklist, /aria-label="Dismiss welcome checklist"/);
    assert.match(checklist, /<ul /);
    assert.match(checklist, /href=\{WELCOME_HOW_IT_WORKS_HREF\}/);
    assert.match(checklist, /\{WELCOME_HOW_IT_WORKS_LABEL\}/);
    assert.equal(WELCOME_HOW_IT_WORKS_HREF, "/how-it-works");
    assert.equal(WELCOME_HOW_IT_WORKS_LABEL, "How it works");
    assert.equal(/\bXP\b|credits/i.test(checklist), false);
    assert.equal(/\bXP\b|credits/i.test(WELCOME_CHECKLIST_HEADLINE), false);
    assert.match(howItWorks, /toastLabel="First time here\?"/);
    assert.match(howItWorks, /toastCtaLabel="Take the tour"/);
    assert.match(howItWorksPage, /HowItWorksWelcomeModal/);
  });

  it("does not lock desktop vote-card height", () => {
    assert.equal(votePage.includes("lockedVoteCardBox"), false);
    assert.equal(checklist.includes("h-[339px]"), false);
    assert.equal(checklist.includes("max-h-["), false);
  });
});

describe("quick vote entry pill on /vote", () => {
  const host = readFileSync(
    new URL("../client/src/components/quick-vote/QuickVoteHost.tsx", import.meta.url),
    "utf8",
  );

  it("does not render while the welcome checklist is eligible", () => {
    const store = memory();
    const input = quickVoteEntryNudgeInput("vote", null, store);
    assert.equal(input.checklistPhase, "checklist");
    assert.equal(input.deviceDismissed, false);
    assert.equal(input.userDismissed, false);
    assert.equal(input.persistedComplete, false);
    assert.equal(isQuickVoteEntryNudgeAllowed(input), false);
  });

  it("stays hidden after a signed-out dismiss, including once that visitor signs in", () => {
    const store = memory();
    writeWelcomeDeviceDismissed(store);
    assert.equal(store.getItem("voxdex_welcome_checklist_dismissed"), "1");

    const signedOut = quickVoteEntryNudgeInput("vote", null, store);
    assert.equal(signedOut.checklistPhase, "hidden");
    assert.equal(signedOut.deviceDismissed, true);
    assert.equal(isQuickVoteEntryNudgeAllowed(signedOut), false);

    const signedIn = quickVoteEntryNudgeInput("vote", "user-a", store);
    assert.equal(signedIn.deviceDismissed, true);
    assert.equal(signedIn.checklistPhase, "hidden");
    assert.equal(isQuickVoteEntryNudgeAllowed(signedIn), false);
  });

  it("stays hidden after a signed-in dismiss or a completed checklist", () => {
    const dismissed = memory();
    writeWelcomeUserDismissed(dismissed, "user-a");
    assert.equal(dismissed.getItem("voxdex_welcome_checklist_dismissed:user-a"), "1");
    const dismissedInput = quickVoteEntryNudgeInput("vote", "user-a", dismissed);
    assert.equal(dismissedInput.userDismissed, true);
    assert.equal(dismissedInput.checklistPhase, "hidden");
    assert.equal(isQuickVoteEntryNudgeAllowed(dismissedInput), false);

    const done = memory();
    writeWelcomeComplete(done, "user-a");
    assert.equal(done.getItem("voxdex_welcome_checklist_complete:user-a"), "1");
    const doneInput = quickVoteEntryNudgeInput("vote", "user-a", done);
    assert.equal(doneInput.persistedComplete, true);
    assert.equal(doneInput.checklistPhase, "hidden");
    assert.equal(isQuickVoteEntryNudgeAllowed(doneInput), false);
  });

  it("keeps the pill off when the checklist is open for a returning signed-in visitor", () => {
    const store = memory();
    writeWelcomeOpen(store, "user-a");
    const input = quickVoteEntryNudgeInput("vote", "user-a", store);
    assert.equal(input.checklistPhase, "checklist");
    assert.equal(isQuickVoteEntryNudgeAllowed(input), false);
  });

  it("leaves the rankings nudge in place", () => {
    const eligible = quickVoteEntryNudgeInput("home", null, memory());
    assert.equal(eligible.checklistPhase, "checklist");
    assert.equal(isQuickVoteEntryNudgeAllowed(eligible), true);

    const dismissed = memory();
    writeWelcomeDeviceDismissed(dismissed);
    assert.equal(isQuickVoteEntryNudgeAllowed(quickVoteEntryNudgeInput("home", null, dismissed)), true);
  });

  it("gates the vote host so the pill cannot mount on the vote surface", () => {
    assert.match(votePage, /<QuickVoteHost[\s\S]*?surface="vote"/);
    assert.match(host, /isQuickVoteEntryNudgeAllowed\(\s*quickVoteEntryNudgeInput\(surface, user\?\.id \?\? null\),?\s*\)/);
    assert.match(host, /if \(!entryNudgeAllowed\) return;/);
    assert.match(host, /\{entryNudgeAllowed && nudgeVisible && !overlayOpen && \(/);
    assert.equal(host.includes('if (!isMobile && surface === "vote") return;'), false);
    assert.match(host, /data-testid="quick-vote-reentry-pill"/);
    assert.match(host, /data-testid="quick-vote-nudge-pill"/);
  });
});

describe("anonymous welcome vote tick", () => {
  it("ticks from the anon-budget payload that survives a reload, and from nothing else", () => {
    const voted = { authenticated: false, used: 1, limit: 8, remaining: 7, exhausted: false };
    assert.equal(anonBudgetProvesVote(voted), true);
    assert.equal(anonBudgetProvesVote({ ...voted, used: 4 }), true);
    assert.equal(anonBudgetProvesVote({ ...voted, used: 0 }), false);
    assert.equal(anonBudgetProvesVote({ authenticated: true }), false);
    assert.equal(anonBudgetProvesVote({ used: 3 }), false);
    assert.equal(anonBudgetProvesVote(null), false);
    assert.equal(anonBudgetProvesVote([]), false);
    assert.equal(welcomeDoneCount({ hasVote: true, hasPrediction: null, hasFavorite: null }), 1);
    assert.equal(welcomeProgressLabel(1), "1 of 3");
  });

  it("reads that budget in the checklist and does not invent a vote flag", () => {
    assert.match(checklist, /useAnonBudget\(\)/);
    assert.match(checklist, /anonBudgetProvesVote\(/);
    assert.equal(checklist.includes("voxdex_welcome_anon_voted"), false);
    assert.equal(checklist.includes("authoridex-has-ever-voted"), false);
    assert.match(checklist, /motion-reduce:transition-none/);
    assert.match(checklist, /WELCOME_ACCOUNT_GATE_LABEL/);
    assert.match(checklist, /aria-hidden=\{showJoin \? undefined : true\}/);
    assert.match(checklist, /reason: "favorite_signup"/);
    assert.match(checklist, /reason: "predict_signup"/);
    assert.equal(checklist.includes("h-[339px]"), false);
    assert.equal(checklist.includes("lockedVoteCardBox"), false);
  });
});

describe("signed-out welcome pivot", () => {
  it("keeps 0 of 3, then pivots once the vote step is done", () => {
    assert.equal(welcomeProgressLabel(0), "0 of 3");
    assert.equal(welcomeProgressLabel(0, { signedOutNudge: true }), "0 of 3");
    assert.equal(welcomeProgressLabel(1), "1 of 3");
    assert.equal(
      welcomeProgressLabel(1, { signedOutNudge: true }),
      `1 of 3 · ${WELCOME_SIGNED_OUT_NUDGE}`,
    );
    assert.equal(welcomeProgressLabel(1, { signedOutNudge: true }), "1 of 3 · 2 more with a free account");
    assert.equal(welcomeProgressLabel(3, { signedOutNudge: true }), "3 of 3");
    assert.equal(WELCOME_FREE_ACCOUNT_HINT, "Free account");
    assert.equal(WELCOME_ACCOUNT_GATE_LABEL, "requires a free account");
    assert.equal(WELCOME_JOIN_FREE_LABEL, "Join free");
    assert.equal(welcomeStepNeedsAccount("vote", true), false);
    assert.equal(welcomeStepNeedsAccount("predict", true), true);
    assert.equal(welcomeStepNeedsAccount("favorite", true), true);
    assert.equal(welcomeStepNeedsAccount("predict", false), false);
    assert.equal(welcomeStepNeedsAccount("favorite", false), false);
  });
});

describe("contextual signup from the checklist", () => {
  it("sends Favorite to favorite_signup and Predict to predict_signup", () => {
    assert.equal(
      authLoginPath({ mode: "signup", reason: "favorite_signup" }),
      "/login?mode=signup&reason=favorite_signup",
    );
    assert.equal(
      authLoginPath({ mode: "signup", reason: "predict_signup" }),
      "/login?mode=signup&reason=predict_signup",
    );
    assert.equal(authLoginPath({ mode: "signup" }), "/login?mode=signup");
    assert.equal(parseAuthReason("favorite_signup"), "favorite_signup");
    assert.equal(parseAuthReason("predict_signup"), "predict_signup");
    assert.equal(parseAuthReason("vote_limit_reached"), "vote_limit_reached");
    assert.equal(parseAuthReason("nope"), null);
    assert.equal(parseAuthReason(null), null);
  });

  it("reflects the reason in the signup heading and subtext, and keeps the generic fallback", () => {
    assert.deepEqual(signupFormCopy(false, "predict_signup"), {
      title: "Create a free account to make predictions",
      description: "You've got the instinct.",
    });
    assert.deepEqual(signupFormCopy(false, "favorite_signup"), {
      title: "Create a free account to save your favourites",
      description: "Keep the ones you follow.",
    });
    assert.deepEqual(signupFormCopy(false, null), {
      title: SIGNUP_GENERIC_TITLE,
      description: SIGNUP_GENERIC_DESCRIPTION,
    });
    assert.equal(signupFormCopy(true, "favorite_signup").title, "Welcome back");
    assert.equal(SIGNUP_GENERIC_TITLE, "Create your account");

    const login = readFileSync(new URL("../client/src/pages/LoginPage.tsx", import.meta.url), "utf8");
    const modal = readFileSync(
      new URL("../client/src/components/auth/SignupReasonModal.tsx", import.meta.url),
      "utf8",
    );
    assert.match(login, /signupFormCopy\(isLogin, formReason\)/);
    assert.match(login, /parseAuthReason\(/);
    assert.match(modal, /You've got the instinct\./);
    assert.match(modal, /Create a free account to save your favourites\./);
    assert.match(modal, /favorite_signup:/);
  });
});

describe("post-vote strip vs welcome checklist", () => {
  it("suppresses the strip while the checklist is open and keeps it after dismiss", () => {
    assert.equal(isVoteChecklistRoute("/"), true);
    assert.equal(isVoteChecklistRoute("/vote"), true);
    assert.equal(isVoteChecklistRoute("/vote/"), true);
    assert.equal(isVoteChecklistRoute("/rankings"), false);
    assert.equal(isVoteChecklistRoute("/people/ada"), false);
    assert.equal(
      welcomeChecklistSuppressesAnonNudge({ pathname: "/", deviceDismissed: false }),
      true,
    );
    assert.equal(
      welcomeChecklistSuppressesAnonNudge({ pathname: "/vote?section=all", deviceDismissed: false }),
      true,
    );
    assert.equal(
      welcomeChecklistSuppressesAnonNudge({ pathname: "/", deviceDismissed: true }),
      false,
    );
    assert.equal(
      welcomeChecklistSuppressesAnonNudge({ pathname: "/rankings", deviceDismissed: false }),
      false,
    );
    assert.equal(
      anonNudgePlacement({ show: true, pathname: "/", deviceDismissed: false }),
      "hidden",
    );
    assert.equal(
      anonNudgePlacement({ show: true, pathname: "/vote", deviceDismissed: true }),
      "above-nav",
    );
    assert.equal(
      anonNudgePlacement({ show: true, pathname: "/rankings", deviceDismissed: false }),
      "under-header",
    );
    assert.equal(
      anonNudgePlacement({ show: false, pathname: "/rankings", deviceDismissed: true }),
      "hidden",
    );
  });

  it("hides the strip on auth screens, including checklist signup redirects", () => {
    const shown = { show: true, deviceDismissed: true };
    const authUrls = [
      "/login",
      "/login?mode=signup",
      "/login?mode=signup&reason=predict_signup",
      "/login?mode=signup&reason=favorite_signup",
      "/login?mode=signup&reason=predict_signup&email=a@b.com",
      "/login?mode=signup&redirect=/predict",
      "/login/verify",
      "/login/verify?email=a@b.com",
      "/login/welcome",
      "/auth/callback",
      "/auth/callback?code=pkce",
      "/reset-password",
      "/forgot-password",
      "/signup",
      "/sign-up",
    ];
    for (const url of authUrls) {
      assert.equal(isAuthSurfaceRoute(url), true, url);
      assert.equal(anonNudgePlacement({ ...shown, pathname: url }), "hidden", url);
    }
    assert.equal(isAuthSurfaceRoute("/rankings"), false);
    assert.equal(isAuthSurfaceRoute("/login-help"), false);
  });

  it("reserves strip height on pages without the shared header", () => {
    const shown = { show: true, deviceDismissed: false };
    const reserves = [
      "/contact",
      "/unsubscribe",
      "/account-deletion",
      "/takedown",
      "/vote/all-ratings",
      "/vote/induction",
      "/vote/opinion-polls/some-slug",
      "/vote/matchups/some-slug",
      "/polls/some-slug",
      "/me/favorites",
      "/me/votes",
      "/predict/updown/abc",
      "/predict/h2h/abc",
      "/predict/race/abc",
      "/predict/activity",
      "/admin",
    ];
    for (const url of reserves) {
      assert.equal(anonNudgeReservesSpace(url), true, url);
      assert.equal(anonNudgePlacement({ ...shown, pathname: url }), "in-flow", url);
    }
    assert.equal(anonNudgeReservesSpace("/rankings"), false);
    assert.equal(anonNudgeReservesSpace("/predict"), false);
    assert.equal(anonNudgeReservesSpace("/me"), false);
    assert.equal(anonNudgeReservesSpace("/me/settings"), false);
    assert.equal(anonNudgeReservesSpace("/person/ada"), false);
    assert.equal(
      anonNudgePlacement({ ...shown, pathname: "/how-it-works" }),
      "under-header",
    );
    assert.equal(
      anonNudgePlacement({ ...shown, pathname: "/terms" }),
      "under-header",
    );
  });

  it("tells the strip to leave document flow, and notifies a same-tab dismiss", () => {
    const nudge = readFileSync(
      new URL("../client/src/components/AnonFirstVoteNudge.tsx", import.meta.url),
      "utf8",
    );
    assert.match(nudge, /anonNudgePlacement\(/);
    assert.match(nudge, /fixed inset-x-0/);
    assert.match(nudge, /"in-flow": "relative z-30 w-full border-b"/);
    assert.equal(nudge.includes("container mx-auto flex"), true);
    assert.match(nudge, /data-nudge-placement=\{placement\}/);
    let heard = 0;
    const stop = subscribeWelcomeDeviceDismiss(() => {
      heard += 1;
    });
    const store = memory();
    writeWelcomeDeviceDismissed(store);
    assert.equal(heard, 1);
    assert.equal(readWelcomeDeviceDismissed(store), true);
    stop();
    writeWelcomeDeviceDismissed(store);
    assert.equal(heard, 1);
  });
});
