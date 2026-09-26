import test from "node:test";
import assert from "node:assert/strict";

import { parseVoteError } from "../client/src/lib/voteErrors";
import {
  OFFLINE_CONFIRM_MS,
  ONLINE_CONFIRM_MS,
  RESTORED_BANNER_MS,
  classifyLink,
  connectivityDelayMs,
  initialConnectivityState,
  isTransportFailure,
  publishLink,
  reduceConnectivitySample,
  reduceConnectivityTick,
  resetPublishedLinkForTests,
  shouldReplaceEmptyWithOffline,
  transportFailureDescription,
  type ConnectivityState,
  type NetworkSample,
} from "../client/src/lib/networkStatus";

const WIFI: NetworkSample = { connected: true, connectionType: "wifi" };
const NONE: NetworkSample = { connected: false, connectionType: "none" };
const SLOW: NetworkSample = { connected: true, connectionType: "cellular", effectiveType: "2g" };

function live(state: ConnectivityState, sample: NetworkSample, now: number) {
  return reduceConnectivitySample(state, sample, now, "live");
}

test("classifyLink treats a missing radio as offline and 2g as poor but reachable", () => {
  assert.equal(classifyLink(NONE), "offline");
  assert.equal(classifyLink({ connected: true, connectionType: "none" }), "offline");
  assert.equal(classifyLink(WIFI), "online");
  assert.equal(classifyLink({ connected: true, connectionType: "unknown" }), "online");
  assert.equal(classifyLink(SLOW), "poor");
  assert.equal(classifyLink({ ...SLOW, effectiveType: "slow-2g" }), "poor");
  assert.equal(classifyLink({ connected: true, connectionType: "cellular", effectiveType: "4g" }), "online");
});

test("the first sample publishes immediately and does not announce a restore", () => {
  const offline = reduceConnectivitySample(initialConnectivityState(), NONE, 0, "initial");
  assert.equal(offline.reachabilityChanged, true);
  assert.equal(offline.state.published.banner, "offline");
  assert.equal(offline.state.published.reachability, "offline");

  const online = reduceConnectivitySample(initialConnectivityState(), WIFI, 0, "initial");
  assert.equal(online.reachabilityChanged, false);
  assert.equal(online.state.published.banner, "hidden");

  const poor = reduceConnectivitySample(initialConnectivityState(), SLOW, 0, "initial");
  assert.equal(poor.reachabilityChanged, false);
  assert.equal(poor.state.published.quality, "poor");
  assert.equal(poor.state.published.reachability, "online");
  assert.equal(poor.state.published.banner, "hidden");
});

test("a short flap does not publish offline or schedule a refetch", () => {
  let step = live(initialConnectivityState(), NONE, 1_000);
  assert.equal(step.reachabilityChanged, false);
  assert.equal(step.state.published.reachability, "online");
  assert.equal(connectivityDelayMs(step.state, 1_000), OFFLINE_CONFIRM_MS);

  step = live(step.state, WIFI, 1_000 + OFFLINE_CONFIRM_MS - 1);
  assert.equal(step.state.pendingReachability, null);
  assert.equal(step.state.published.banner, "hidden");

  const tick = reduceConnectivityTick(step.state, 5_000);
  assert.equal(tick.reachabilityChanged, false);
  assert.equal(tick.state.published.reachability, "online");
  assert.equal(connectivityDelayMs(tick.state, 5_000), null);
});

test("offline sticks only after the confirm window, then one reconnect", () => {
  let step = live(initialConnectivityState(), NONE, 0);
  const tooSoon = reduceConnectivityTick(step.state, OFFLINE_CONFIRM_MS - 1);
  assert.equal(tooSoon.state.published.banner, "hidden");
  assert.equal(tooSoon.reachabilityChanged, false);

  const confirmed = reduceConnectivityTick(step.state, OFFLINE_CONFIRM_MS);
  assert.equal(confirmed.reachabilityChanged, true);
  assert.equal(confirmed.state.published.banner, "offline");
  assert.equal(confirmed.state.published.reachability, "offline");

  step = live(confirmed.state, WIFI, 10_000);
  assert.equal(step.reachabilityChanged, false);
  assert.equal(step.state.published.banner, "offline");

  const early = reduceConnectivityTick(step.state, 10_000 + ONLINE_CONFIRM_MS - 1);
  assert.equal(early.state.published.reachability, "offline");

  const back = reduceConnectivityTick(step.state, 10_000 + ONLINE_CONFIRM_MS);
  assert.equal(back.reachabilityChanged, true);
  assert.equal(back.state.published.reachability, "online");
  assert.equal(back.state.published.banner, "restored");

  const hidden = reduceConnectivityTick(back.state, 10_000 + ONLINE_CONFIRM_MS + RESTORED_BANNER_MS);
  assert.equal(hidden.reachabilityChanged, false);
  assert.equal(hidden.state.published.banner, "hidden");
  assert.equal(hidden.state.published.reachability, "online");
});

test("returning on a 2g link counts as online and does not keep the offline banner", () => {
  const offline = reduceConnectivitySample(initialConnectivityState(), NONE, 0, "initial");
  const pending = live(offline.state, SLOW, 50);
  const back = reduceConnectivityTick(pending.state, 50 + ONLINE_CONFIRM_MS);
  assert.equal(back.reachabilityChanged, true);
  assert.equal(back.state.published.reachability, "online");
  assert.equal(back.state.published.quality, "poor");
  assert.equal(back.state.published.banner, "restored");
});

test("duplicate offline samples do not reset the confirm clock", () => {
  const first = live(initialConnectivityState(), NONE, 100);
  const second = live(first.state, NONE, 100 + OFFLINE_CONFIRM_MS - 10);
  assert.equal(second.state.pendingSince, 100);
  const confirmed = reduceConnectivityTick(second.state, 100 + OFFLINE_CONFIRM_MS);
  assert.equal(confirmed.state.published.banner, "offline");
});

test("isTransportFailure ignores HTTP errors that reuse the fetch phrase", () => {
  assert.equal(isTransportFailure(new TypeError("Failed to fetch")), true);
  assert.equal(isTransportFailure(new TypeError("Load failed")), true);
  assert.equal(
    isTransportFailure(new TypeError("NetworkError when attempting to fetch resource.")),
    true,
  );
  assert.equal(isTransportFailure(new Error("Failed to fetch")), false);
  assert.equal(isTransportFailure(new Error("500: {\"error\":\"nope\"}")), false);
  assert.equal(isTransportFailure(new Error("429: slow down")), false);
});

test("empty-state replacement only covers a fetch that never resolved", () => {
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "pending",
      fetchStatus: "paused",
      transportError: false,
      offline: true,
    }),
    "offline",
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "pending",
      fetchStatus: "paused",
      transportError: false,
      offline: false,
    }),
    null,
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "pending",
      fetchStatus: "fetching",
      transportError: false,
      offline: false,
    }),
    null,
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "success",
      fetchStatus: "paused",
      transportError: false,
      offline: true,
    }),
    null,
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "error",
      fetchStatus: "idle",
      transportError: true,
      offline: false,
    }),
    "unreachable",
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "error",
      fetchStatus: "idle",
      transportError: true,
      offline: true,
    }),
    "offline",
  );
  assert.equal(
    shouldReplaceEmptyWithOffline({
      status: "error",
      fetchStatus: "idle",
      transportError: false,
      offline: true,
    }),
    null,
  );
});

test("vote and prediction errors stay specific, and transport failures get connection copy", () => {
  resetPublishedLinkForTests();
  assert.equal(transportFailureDescription(), "Check your connection and try again.");
  assert.equal(
    parseVoteError(new TypeError("Failed to fetch")).message,
    "Check your connection and try again.",
  );
  assert.equal(parseVoteError(new Error("Failed to fetch")).message, "Failed to fetch");
  assert.equal(parseVoteError(new Error("429: slow down")).message, "Too many votes. Please slow down.");

  publishLink({ reachability: "offline", quality: "offline", banner: "offline" });
  assert.equal(transportFailureDescription(), "You're offline. Try again when you reconnect.");
  assert.equal(
    parseVoteError(new TypeError("Failed to fetch")).message,
    "You're offline. Try again when you reconnect.",
  );
  resetPublishedLinkForTests();
  assert.equal(transportFailureDescription(), "Check your connection and try again.");
});
