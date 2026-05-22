import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveMarketingGateFromSnapshot,
  type MarketingGateDbSnapshot,
} from "../server/emails/marketing-gate-logic";

const optedIn: MarketingGateDbSnapshot = {
  isUnsubscribed: false,
  predictionsEmail: true,
  favoritesEmail: false,
  socialEmail: false,
  accountEmail: false,
};

test("auth category always allowed", () => {
  const result = resolveMarketingGateFromSnapshot(
    { category: "auth", userId: "u1" },
    { isUnsubscribed: true, predictionsEmail: false, favoritesEmail: false, socialEmail: false, accountEmail: false },
  );
  assert.equal(result.allowed, true);
});

test("lifecycle blocked when unsubscribed", () => {
  const result = resolveMarketingGateFromSnapshot(
    { category: "lifecycle", userId: "u1" },
    { ...optedIn, isUnsubscribed: true },
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.reason, "unsubscribed");
});

test("lifecycle allowed when skipMarketingChecks", () => {
  const result = resolveMarketingGateFromSnapshot(
    { category: "lifecycle", userId: "u1", skipMarketingChecks: true },
    { ...optedIn, isUnsubscribed: true },
  );
  assert.equal(result.allowed, true);
});

test("engagement requires preferenceKey", () => {
  const result = resolveMarketingGateFromSnapshot(
    { category: "engagement", userId: "u1" },
    optedIn,
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.reason, "missing_preference_key");
});

test("engagement blocked when preference off", () => {
  const result = resolveMarketingGateFromSnapshot(
    {
      category: "engagement",
      userId: "u1",
      preferenceKey: "predictionsEmail",
    },
    { ...optedIn, predictionsEmail: false },
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.reason, "preference_off");
});

test("engagement allowed when preference on and not unsubscribed", () => {
  const result = resolveMarketingGateFromSnapshot(
    {
      category: "engagement",
      userId: "u1",
      preferenceKey: "predictionsEmail",
    },
    optedIn,
  );
  assert.equal(result.allowed, true);
});

test("engagement blocked when unsubscribed even if preference on", () => {
  const result = resolveMarketingGateFromSnapshot(
    {
      category: "engagement",
      userId: "u1",
      preferenceKey: "predictionsEmail",
    },
    { ...optedIn, isUnsubscribed: true },
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.reason, "unsubscribed");
});
