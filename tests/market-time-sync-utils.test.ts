import test from "node:test";
import assert from "node:assert/strict";

import {
  computeLockCloseAt,
  computeResyncedTimes,
  shouldApplyResync,
  DEFAULT_RESYNC_THRESHOLD_MS,
  parseExplicitBackstopFromRules,
  deriveResolutionBackstop,
  deriveTradingCloseAt,
  decideCommunityResolution,
  looksLikeDataLagsMarket,
  DEFAULT_TRADING_EXTENSION_DAYS,
} from "../server/jobs/market-time-sync-utils";

const COOLDOWN_MS = 5 * 60 * 1000;
const NOW = new Date("2026-07-12T12:00:00.000Z");

test("computeLockCloseAt locks when closeAt is null", () => {
  const locked = computeLockCloseAt(null, NOW);
  assert.ok(locked);
  assert.equal(locked!.toISOString(), NOW.toISOString());
});

test("computeLockCloseAt locks when closeAt is still in the future", () => {
  const future = new Date("2026-07-12T18:00:00.000Z");
  const locked = computeLockCloseAt(future, NOW);
  assert.ok(locked);
  assert.equal(locked!.toISOString(), NOW.toISOString());
});

test("computeLockCloseAt is idempotent when already past cutoff", () => {
  const past = new Date("2026-07-12T11:00:00.000Z");
  assert.equal(computeLockCloseAt(past, NOW), null);
});

test("computeResyncedTimes: closeAt = endAt − cooldown when no kickoff", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: null,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out!.endAt.toISOString(), end);
  assert.equal(
    out!.closeAt.toISOString(),
    new Date(Date.parse(end) - COOLDOWN_MS).toISOString(),
  );
});

test("computeResyncedTimes: kickoff wins when earlier than default cutoff", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const kickoff = "2026-07-12T20:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: kickoff,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(out!.closeAt.toISOString(), kickoff);
});

test("computeResyncedTimes: ignores kickoff already in the past", () => {
  const end = "2026-07-13T00:00:00.000Z";
  const pastKickoff = "2026-07-12T10:00:00.000Z";
  const out = computeResyncedTimes({
    sourceEndDate: end,
    sourceGameStartTime: pastKickoff,
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.ok(out);
  assert.equal(
    out!.closeAt.toISOString(),
    new Date(Date.parse(end) - COOLDOWN_MS).toISOString(),
  );
});

test("computeResyncedTimes: returns null when source end is in the past", () => {
  const out = computeResyncedTimes({
    sourceEndDate: "2026-07-12T11:00:00.000Z",
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.equal(out, null);
});

test("computeResyncedTimes: returns null on invalid end date", () => {
  const out = computeResyncedTimes({
    sourceEndDate: "not-a-date",
    cooldownMs: COOLDOWN_MS,
    now: NOW,
  });
  assert.equal(out, null);
});

test("shouldApplyResync: applies when source moved past threshold and we own times", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const source = "2026-07-14T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: ignores tiny drift under threshold", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const source = new Date(
    Date.parse(synced) + DEFAULT_RESYNC_THRESHOLD_MS / 2,
  ).toISOString();
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: backs off when admin manually edited endAt", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const adminEdited = "2026-07-15T12:00:00.000Z";
  const source = "2026-07-14T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(adminEdited),
    syncedEndDate: synced,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: legacy baseline adopt when current matches source", () => {
  const source = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(source),
    syncedEndDate: null,
    sourceEndDate: source,
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: true });
});

test("shouldApplyResync: legacy skip when current diverges from source (manual edit unknown)", () => {
  const out = shouldApplyResync({
    currentEndAt: new Date("2026-07-15T12:00:00.000Z"),
    syncedEndDate: null,
    sourceEndDate: "2026-07-13T00:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: applies when kickoff moves even if endDate unchanged", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: "2026-07-12T18:00:00.000Z",
    sourceGameStartTime: "2026-07-12T21:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: ignores tiny kickoff drift under threshold", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const kick = "2026-07-12T18:00:00.000Z";
  const slight = new Date(
    Date.parse(kick) + DEFAULT_RESYNC_THRESHOLD_MS / 2,
  ).toISOString();
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: kick,
    sourceGameStartTime: slight,
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: kickoff appearing for the first time counts as a move", () => {
  const synced = "2026-07-13T00:00:00.000Z";
  const out = shouldApplyResync({
    currentEndAt: new Date(synced),
    syncedEndDate: synced,
    sourceEndDate: synced,
    syncedGameStartTime: null,
    sourceGameStartTime: "2026-07-12T18:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: true, isLegacyBaselineAdopt: false });
});

test("shouldApplyResync: rejects past source end", () => {
  const out = shouldApplyResync({
    currentEndAt: new Date("2026-07-12T10:00:00.000Z"),
    syncedEndDate: "2026-07-12T10:00:00.000Z",
    sourceEndDate: "2026-07-12T11:00:00.000Z",
    now: NOW,
  });
  assert.deepEqual(out, { apply: false, isLegacyBaselineAdopt: false });
});

// ---- Resolution backstop / data-lags --------------------------------------

const CHARLI_RULES = `Charli XCX's new album 'Music, Fashion, Film' is expected to release July 24, 2026.

This market will resolve according to the debut week sales for Charli XCX's album 'Music, Fashion, Film', according to Hits Daily Double.

If the album 'Music, Fashion, Film' has not been released by August 31, 2026, 11:59 PM ET, this market will resolve to the lowest bracket.`;

test("parseExplicitBackstopFromRules: extracts August 31, 2026", () => {
  const d = parseExplicitBackstopFromRules(CHARLI_RULES);
  assert.ok(d);
  assert.equal(d!.toISOString().slice(0, 10), "2026-08-31");
});

test("parseExplicitBackstopFromRules: null on empty / no date", () => {
  assert.equal(parseExplicitBackstopFromRules(null), null);
  assert.equal(parseExplicitBackstopFromRules("Resolves when the match ends."), null);
});

test("looksLikeDataLagsMarket: debut-week / box-office keywords", () => {
  assert.equal(looksLikeDataLagsMarket("first week album sales"), true);
  assert.equal(looksLikeDataLagsMarket("opening weekend box office"), true);
  assert.equal(looksLikeDataLagsMarket("Will Team A beat Team B?"), false);
});

test("deriveResolutionBackstop: prefers explicit rules date", () => {
  const out = deriveResolutionBackstop({
    endDate: "2026-07-24T00:00:00.000Z",
    rulesText: CHARLI_RULES,
  });
  assert.ok(out);
  assert.equal(out!.fromRules, true);
  assert.equal(out!.isDataLags, true);
  assert.equal(out!.backstopAt.toISOString().slice(0, 10), "2026-08-31");
});

test("deriveResolutionBackstop: explicit date without data-lags keywords is not data-lags", () => {
  const out = deriveResolutionBackstop({
    endDate: "2026-09-14T00:00:00.000Z",
    rulesText:
      "Resolves to the Emmy winner. If the awards are cancelled, resolve by October 31, 2026.",
    contextText: "Who will win the 2026 Emmy for Lead Actress?",
  });
  assert.ok(out);
  assert.equal(out!.fromRules, true);
  assert.equal(out!.isDataLags, false);
  assert.equal(out!.backstopAt.toISOString().slice(0, 10), "2026-10-31");
});

test("deriveResolutionBackstop: buffer fallback for keyword data-lags without date", () => {
  const out = deriveResolutionBackstop({
    endDate: "2026-07-24T00:00:00.000Z",
    rulesText: "Resolves on first week album sales per Hits Daily Double.",
    bufferDays: 45,
  });
  assert.ok(out);
  assert.equal(out!.fromRules, false);
  assert.equal(out!.isDataLags, true);
  assert.equal(
    out!.backstopAt.toISOString(),
    new Date(
      Date.parse("2026-07-24T00:00:00.000Z") + 45 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  );
});

test("deriveResolutionBackstop: short buffer for non-data-lags sports", () => {
  const out = deriveResolutionBackstop({
    endDate: "2026-07-24T20:00:00.000Z",
    rulesText: "Resolves to the team that wins the match.",
    contextText: "Will Arsenal beat Chelsea?",
    bufferDays: 45,
  });
  assert.ok(out);
  assert.equal(out!.isDataLags, false);
  assert.equal(
    out!.backstopAt.toISOString(),
    new Date(
      Date.parse("2026-07-24T20:00:00.000Z") + 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  );
});

test("deriveTradingCloseAt: data-lags extends past endDate", () => {
  const end = "2026-07-24T00:00:00.000Z";
  const backstop = new Date("2026-08-31T23:59:00.000Z");
  const close = deriveTradingCloseAt({
    endDate: end,
    backstopAt: backstop,
    isDataLags: true,
    cooldownMs: COOLDOWN_MS,
    extensionDays: DEFAULT_TRADING_EXTENSION_DAYS,
    now: new Date("2026-07-16T00:00:00.000Z"),
  });
  assert.ok(close);
  const expectedTradingEnd = Date.parse(end) + DEFAULT_TRADING_EXTENSION_DAYS * 86400000;
  assert.equal(
    close!.toISOString(),
    new Date(expectedTradingEnd - COOLDOWN_MS).toISOString(),
  );
});

test("deriveTradingCloseAt: non-data-lags uses endDate − cooldown", () => {
  const end = "2026-07-24T20:00:00.000Z";
  const close = deriveTradingCloseAt({
    endDate: end,
    backstopAt: new Date("2026-07-31T20:00:00.000Z"),
    isDataLags: false,
    cooldownMs: COOLDOWN_MS,
    now: new Date("2026-07-16T00:00:00.000Z"),
  });
  assert.ok(close);
  assert.equal(
    close!.toISOString(),
    new Date(Date.parse(end) - COOLDOWN_MS).toISOString(),
  );
});

test("deriveTradingCloseAt: kickoff wins when earlier", () => {
  const end = "2026-07-24T20:00:00.000Z";
  const kickoff = "2026-07-24T18:00:00.000Z";
  const close = deriveTradingCloseAt({
    endDate: end,
    backstopAt: new Date("2026-07-31T20:00:00.000Z"),
    isDataLags: false,
    cooldownMs: COOLDOWN_MS,
    gameStartTime: kickoff,
    now: new Date("2026-07-16T00:00:00.000Z"),
  });
  assert.ok(close);
  assert.equal(close!.toISOString(), kickoff);
});

test("decideCommunityResolution: manual market queues immediately", () => {
  const out = decideCommunityResolution({
    source: null,
    endAt: new Date("2026-07-24T00:00:00.000Z"),
    backstopAt: new Date("2026-09-01T00:00:00.000Z"),
    now: new Date("2026-07-24T01:00:00.000Z"),
  });
  assert.deepEqual(out, { action: "queue", reason: "manual_or_unknown" });
});

test("decideCommunityResolution: upstream resolved queues", () => {
  const out = decideCommunityResolution({
    source: {
      provider: "polymarket",
      upstreamResolvedAt: "2026-08-03T12:00:00.000Z",
    },
    endAt: new Date("2026-07-24T00:00:00.000Z"),
    backstopAt: new Date("2026-09-01T00:00:00.000Z"),
    now: new Date("2026-08-03T13:00:00.000Z"),
  });
  assert.deepEqual(out, { action: "queue", reason: "upstream_resolved" });
});

test("decideCommunityResolution: defers when awaiting upstream before backstop", () => {
  const backstop = new Date("2026-09-01T00:00:00.000Z");
  const out = decideCommunityResolution({
    source: { provider: "polymarket", upstreamResolvedAt: null },
    endAt: new Date("2026-07-24T00:00:00.000Z"),
    backstopAt: backstop,
    now: new Date("2026-07-24T01:00:00.000Z"),
  });
  assert.equal(out.action, "defer");
  if (out.action === "defer") {
    assert.equal(out.reason, "awaiting_upstream");
    assert.equal(out.deferEndAt.toISOString(), backstop.toISOString());
  }
});

test("decideCommunityResolution: backstop reached queues unresolved", () => {
  const out = decideCommunityResolution({
    source: { provider: "polymarket" },
    endAt: new Date("2026-07-24T00:00:00.000Z"),
    backstopAt: new Date("2026-09-01T00:00:00.000Z"),
    now: new Date("2026-09-01T00:00:01.000Z"),
  });
  assert.deepEqual(out, {
    action: "queue",
    reason: "backstop_reached_unresolved",
  });
});

test("decideCommunityResolution: scouted without backstop falls through", () => {
  const out = decideCommunityResolution({
    source: { provider: "polymarket" },
    endAt: new Date("2026-07-24T00:00:00.000Z"),
    backstopAt: null,
    now: new Date("2026-07-24T01:00:00.000Z"),
  });
  assert.deepEqual(out, { action: "queue", reason: "manual_or_unknown" });
});
