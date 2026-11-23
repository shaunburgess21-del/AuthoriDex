import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
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
  readWelcomeUserDismissed,
  returningStripAllowed,
  voteListHasBallot,
  welcomeChecklistPhase,
  welcomeCompleteKey,
  welcomeDoneCount,
  welcomeOpenKey,
  welcomeProgressLabel,
  welcomeUserDismissKey,
  writeWelcomeComplete,
  writeWelcomeDeviceDismissed,
  writeWelcomeOpen,
  writeWelcomeUserDismissed,
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
