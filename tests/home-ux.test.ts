import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildLeaderboardCategoryFilters,
  isCategorySlugLabel,
} from "../shared/leaderboard-category-filters";
import {
  HOME_INTRO_COMPACT,
  HOME_INTRO_STEPS,
  HOME_INTRO_TAGLINE,
  homeIntroModeFromStored,
  homeIntroStoredAfterSeen,
} from "../client/src/lib/homeIntro";
import {
  ANON_FIRST_VOTE_NUDGE_COPY,
  shouldShowAnonFirstVoteNudge,
} from "../client/src/lib/anonFirstVoteNudge";
import { sessionJsonHasAccessToken } from "../client/src/lib/authSession";
import {
  clearPublicCache,
  publicFameLeaderboardCacheKey,
  readPublicCache,
  writePublicCache,
} from "../server/services/public-response-cache";
import {
  TOAST_TOP_MIN_CLEARANCE_PX,
  TOAST_TOP_OFFSET,
  TOAST_Z_INDEX,
  DIALOG_Z_INDEX,
  clearanceBelowSticky,
} from "../client/src/lib/toastPlacement";

const PRODUCTION_REGISTRY = [
  { id: "tech", label: "Tech", sortOrder: 10 },
  { id: "crypto", label: "Crypto", sortOrder: 130 },
  { id: "media", label: "Media & Podcast", sortOrder: 130 },
  { id: "media-and-podcast", label: "media-and-podcast", sortOrder: 131 },
  { id: "ai", label: "AI", sortOrder: 140 },
  { id: "streaming", label: "Streaming", sortOrder: 140 },
];

describe("leaderboard category filter", () => {
  it("dedupes media spellings, keeps registry labels, and sorts by sortOrder", () => {
    const options = buildLeaderboardCategoryFilters(PRODUCTION_REGISTRY);
    const labels = options.map((option) => option.label);
    assert.equal(labels.filter((label) => label === "Media & Podcast").length, 1);
    assert.equal(labels.includes("media-and-podcast"), false);
    assert.equal(labels.includes("media"), false);
    assert.ok(labels.includes("Crypto"));
    assert.ok(labels.includes("AI"));
    assert.ok(labels.includes("Streaming"));
    const values = options.map((option) => option.value);
    assert.deepEqual(values.slice(0, 2), ["all", "favorites"]);
    assert.ok(values.indexOf("tech") < values.indexOf("crypto"));
    assert.ok(values.indexOf("crypto") < values.indexOf("ai"));
    assert.equal(values.filter((value) => value === "media").length, 1);
  });

  it("falls back to the canonical list, which includes crypto and ai", () => {
    const options = buildLeaderboardCategoryFilters(null);
    const values = options.map((option) => option.value);
    assert.ok(values.includes("crypto"));
    assert.ok(values.includes("ai"));
    assert.equal(isCategorySlugLabel("media-and-podcast"), true);
    assert.equal(isCategorySlugLabel("Media & Podcast"), false);
  });
});

describe("home intro", () => {
  it("is full on the first visit, compact after it has been seen, hidden after dismiss", () => {
    assert.equal(homeIntroModeFromStored(null), "full");
    assert.equal(homeIntroModeFromStored("seen"), "compact");
    assert.equal(homeIntroModeFromStored("hidden"), "hidden");
    assert.equal(homeIntroStoredAfterSeen(null), "seen");
    assert.equal(homeIntroStoredAfterSeen("hidden"), "hidden");
  });

  it("keeps the copy short and does not call Vox money", () => {
    const copy = [HOME_INTRO_TAGLINE, HOME_INTRO_COMPACT, ...HOME_INTRO_STEPS.map((step) => `${step.title} ${step.detail}`)].join(" ");
    assert.match(copy, /Vote/);
    assert.match(copy, /Predict/);
    assert.match(copy, /Climb/);
    assert.equal(/money|cash|dollar|payout|real currency/i.test(copy), false);
    assert.ok(HOME_INTRO_TAGLINE.length < 80);
  });
});

describe("first anonymous vote nudge", () => {
  it("shows after the first vote and stays out of the way otherwise", () => {
    assert.equal(shouldShowAnonFirstVoteNudge({ isAnonymous: true, used: 0, dismissed: false }), false);
    assert.equal(shouldShowAnonFirstVoteNudge({ isAnonymous: true, used: 1, dismissed: false }), true);
    assert.equal(shouldShowAnonFirstVoteNudge({ isAnonymous: true, used: 7, dismissed: false }), true);
    assert.equal(shouldShowAnonFirstVoteNudge({ isAnonymous: true, used: 1, dismissed: true }), false);
    assert.equal(shouldShowAnonFirstVoteNudge({ isAnonymous: false, used: 3, dismissed: false }), false);
    assert.equal(/money|cash|dollar/i.test(ANON_FIRST_VOTE_NUDGE_COPY), false);
    assert.match(ANON_FIRST_VOTE_NUDGE_COPY, /Sign up to keep your votes and earn XP/);
  });
});

describe("logged-out auth header short circuit", () => {
  it("treats a missing or empty session as logged out", () => {
    assert.equal(sessionJsonHasAccessToken(null), false);
    assert.equal(sessionJsonHasAccessToken(""), false);
    assert.equal(sessionJsonHasAccessToken("{}"), false);
    assert.equal(sessionJsonHasAccessToken(JSON.stringify({ access_token: "abc" })), true);
    assert.equal(sessionJsonHasAccessToken("not-json"), true);
  });
});

describe("public leaderboard cache", () => {
  it("caches fame pages and skips search, favorites, and other tabs", () => {
    assert.equal(
      publicFameLeaderboardCacheKey({ tab: "fame", sortDir: "desc", category: "all", search: "", limit: 20, offset: 0 }),
      "lb:fame:desc:all:20:0",
    );
    assert.equal(
      publicFameLeaderboardCacheKey({ tab: "fame", sortDir: "desc", category: "favorites", limit: 20, offset: 0 }),
      null,
    );
    assert.equal(
      publicFameLeaderboardCacheKey({ tab: "approval", sortDir: "desc", limit: 20, offset: 0 }),
      null,
    );
    assert.equal(
      publicFameLeaderboardCacheKey({ tab: "fame", sortDir: "desc", search: "ada", limit: 20, offset: 0 }),
      null,
    );
  });

  it("expires entries", () => {
    clearPublicCache();
    writePublicCache("k", { ok: true }, 1000, 1_000);
    assert.deepEqual(readPublicCache("k", 1_500), { ok: true });
    assert.equal(readPublicCache("k", 2_001), undefined);
  });
});

describe("fame leaderboard Rate cell", () => {
  it("is desktop-only so names keep the full row on mobile", () => {
    const row = readFileSync(new URL("../client/src/components/LeaderboardRow.tsx", import.meta.url), "utf8");
    const fameStart = row.lastIndexOf('{activeTab === "fame" && (');
    const approvalStart = row.indexOf('{activeTab === "approval" && (', fameStart);
    assert.ok(fameStart > 0 && approvalStart > fameStart);
    const fame = row.slice(fameStart, approvalStart);
    assert.match(fame, /<div className="hidden md:flex">\s*<LeaderboardYourVoteCell/);
    assert.equal(/<div className="flex">\s*<LeaderboardYourVoteCell/.test(fame), false);
  });
});

describe("toast placement", () => {
  it("clears sticky chrome and stays under dialogs", () => {
    assert.equal(TOAST_TOP_OFFSET, "4.75rem");
    assert.equal(TOAST_TOP_MIN_CLEARANCE_PX, 76);
    assert.ok(TOAST_Z_INDEX > 50);
    assert.ok(TOAST_Z_INDEX < DIALOG_Z_INDEX);
    const header = { top: 49, bottom: 114, height: 65 };
    const band = { top: 114, bottom: 177, height: 63 };
    const lowerCard = { top: 420, bottom: 500, height: 80 };
    assert.equal(clearanceBelowSticky([header, band, lowerCard]), 177);
    assert.equal(clearanceBelowSticky([]), 0);
  });
});
