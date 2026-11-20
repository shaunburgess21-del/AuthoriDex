import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { contactSubmissionSchema } from "../shared/contact";
import {
  NEW_ACCOUNT_IS_PUBLIC,
  NEW_ACCOUNT_POSITIONS_PUBLIC,
} from "../shared/schema";
import { XP_ACTIONS, VOTE_SURFACES } from "../client/src/lib/gamification-content";
import { HELP_ARTICLES } from "../server/help/knowledge";
import { FALLBACK_HELP_RATES, renderRatesArticle } from "../server/help/rates";
import {
  TOAST_DURATION_MS,
  TOAST_ERROR_DURATION_MS,
  TOAST_RICH_DURATION_MS,
  TOAST_DESKTOP_MIN_PX,
  TOAST_MOBILE_BOTTOM_OFFSET,
  toastPositionForWidth,
  identicalToastId,
  resolveToastOptions,
} from "../client/src/lib/toast-policy";
import { awardedSuggestionXp } from "../client/src/components/suggest/SuggestionSentDialog";
import { STREAK_TOAST_DURATION_MS } from "../client/src/lib/streak-config";

test("new accounts default to a private profile and hidden open predictions", () => {
  assert.equal(NEW_ACCOUNT_IS_PUBLIC, false);
  assert.equal(NEW_ACCOUNT_POSITIONS_PUBLIC, false);
});

test("privacy migration only changes defaults and the stale sentiment sentence", () => {
  const sql = readFileSync(
    new URL("../migrations/0104_private_profile_defaults.sql", import.meta.url),
    "utf8",
  );
  const journal = readFileSync(
    new URL("../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  );
  assert.match(sql, /ALTER COLUMN is_public SET DEFAULT false/i);
  assert.match(sql, /ALTER COLUMN positions_public SET DEFAULT false/i);
  assert.match(sql, /vote_sentiment/);
  assert.doesNotMatch(sql, /UPDATE\s+(public\.)?profiles/i);
  assert.match(journal, /0104_private_profile_defaults/);
});

test("sentiment guide copy matches Agree / Neutral / Disagree and 1–5 ratings", () => {
  const sentiment = XP_ACTIONS.find((row) => row.actionKey === "vote_sentiment");
  assert.equal(
    sentiment?.description,
    "Agree, Neutral, or Disagree on a sentiment poll",
  );
  assert.equal(
    VOTE_SURFACES.find((row) => row.xpActionKey === "vote_sentiment")?.detail,
    "Agree, Neutral, or Disagree",
  );
  const rating = VOTE_SURFACES.find((row) => row.surface.startsWith("Overall rating"));
  assert.equal(rating?.xpActionKey, null);
  assert.match(rating?.detail ?? "", /1–5|Hate to Love|no XP/);
  assert.equal(
    VOTE_SURFACES.find((row) => row.xpActionKey === "vote_curation")?.where,
    "/vote → Curate Profile",
  );

  const voting = HELP_ARTICLES.find((article) => article.id === "voting");
  assert.match(voting?.body ?? "", /Agree, Neutral, or Disagree/);
  assert.match(voting?.body ?? "", /1 to 5/);
  assert.doesNotMatch(voting?.body ?? "", /1[–-]10/);
  assert.doesNotMatch(JSON.stringify(VOTE_SURFACES), /1[–-]10|hot-or-not/);

  const rates = renderRatesArticle(FALLBACK_HELP_RATES);
  assert.match(rates, /Agree, Neutral, or Disagree on a sentiment poll/);
  assert.doesNotMatch(rates, /1-10 scale/);
});

test("vote rules quote the live 20 XP rate and a tap, not a swipe", () => {
  const source = readFileSync(
    new URL("../client/src/components/rulesStepData.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /\+15 XP|\+25 XP|\+30 XP/);
  assert.match(source, /Tap the photo/);
  assert.doesNotMatch(source, /Swipe left or right/);
  assert.match(source, /up to 10 a day/);
});

test("contact email is required and the honeypot must stay empty", () => {
  const base = {
    name: "Ada",
    email: "ada@example.com",
    topic: "general",
    subject: "Hello there",
    message: "This is a long enough note.",
    website: "",
  };
  assert.equal(contactSubmissionSchema.safeParse(base).success, true);

  const missing = contactSubmissionSchema.safeParse({ ...base, email: "" });
  assert.equal(missing.success, false);
  if (!missing.success) {
    assert.equal(missing.error.issues[0]?.message, "Email is required");
  }

  const blank = contactSubmissionSchema.safeParse({ ...base, email: "   " });
  assert.equal(blank.success, false);
  if (!blank.success) {
    assert.equal(blank.error.issues[0]?.message, "Email is required");
  }

  const invalid = contactSubmissionSchema.safeParse({ ...base, email: "not-an-email" });
  assert.equal(invalid.success, false);
  if (!invalid.success) {
    assert.equal(invalid.error.issues[0]?.message, "Enter a valid email");
  }

  const noTopic = contactSubmissionSchema.safeParse({ ...base, topic: "" });
  assert.equal(noTopic.success, false);
  if (!noTopic.success) {
    assert.equal(noTopic.error.issues[0]?.message, "Choose a topic");
  }

  const honeypot = contactSubmissionSchema.safeParse({ ...base, website: "http://spam" });
  assert.equal(honeypot.success, false);
});

test("toasts default to 3s, errors stay longer, and identical messages share an id", () => {
  assert.equal(TOAST_DURATION_MS, 3_000);
  assert.equal(TOAST_ERROR_DURATION_MS, 5_000);
  assert.equal(TOAST_RICH_DURATION_MS, 4_000);
  assert.equal(STREAK_TOAST_DURATION_MS, TOAST_RICH_DURATION_MS);
  assert.equal(toastPositionForWidth(TOAST_DESKTOP_MIN_PX - 1), "bottom-center");
  assert.equal(toastPositionForWidth(913), "top-center");
  assert.equal(toastPositionForWidth(400), "bottom-center");
  assert.equal(TOAST_MOBILE_BOTTOM_OFFSET, "5.5rem");

  const plain = resolveToastOptions("Saved", undefined, "default");
  assert.equal(plain.duration, 3_000);
  assert.equal(plain.id, identicalToastId("Saved", undefined));

  const again = resolveToastOptions("Saved", { description: "Done" }, "default");
  const same = resolveToastOptions("Saved", { description: "Done" }, "default");
  assert.equal(again.id, same.id);
  assert.notEqual(again.id, plain.id);

  const error = resolveToastOptions("Failed", undefined, "error");
  assert.equal(error.duration, 5_000);

  const explicit = resolveToastOptions("Link copied", { duration: 1500, id: "copy" }, "default");
  assert.equal(explicit.duration, 1500);
  assert.equal(explicit.id, "copy");

  const rich = resolveToastOptions("Saved", { description: { node: true } }, "default");
  assert.equal(rich.id, undefined);
});

test("suggestion confirmation only mentions XP that was actually awarded", () => {
  assert.equal(awardedSuggestionXp({ xp: { xpAwarded: 5 } }), 5);
  assert.equal(awardedSuggestionXp({ xp: { xpAwarded: 0 } }), 0);
  assert.equal(awardedSuggestionXp({}), 0);
  assert.equal(awardedSuggestionXp(null), 0);
});
