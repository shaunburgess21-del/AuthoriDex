import { Capacitor } from "@capacitor/core";
import { onlineManager } from "@tanstack/react-query";
import {
  connectivityDelayMs,
  initialConnectivityState,
  publishLink,
  reduceConnectivitySample,
  reduceConnectivityTick,
  sampleFromNavigator,
  type ConnectivityState,
  type NetworkSample,
} from "@/lib/networkStatus";

/**
 * Android Capacitor only. Subscribes to `@capacitor/network` and drives
 * TanStack Query's online manager from that signal.
 *
 * `navigator.onLine` stays true in the Android WebView across airplane
 * mode often enough that the default window listener never pauses
 * queries. Website, PWA, and iOS do not call this, so their reconnect
 * behavior is unchanged.
 */

const SLOT_KEY = "__voxdexAndroidNetwork";
const PRIME_TIMEOUT_MS = 1500;

interface NetworkSlot {
  installed: boolean;
  setOnline: ((online: boolean) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  removePlugin: (() => void) | null;
  removeFallback: (() => void) | null;
}

function networkSlot(): NetworkSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: NetworkSlot };
  if (!g[SLOT_KEY]) {
    g[SLOT_KEY] = {
      installed: false,
      setOnline: null,
      timer: null,
      removePlugin: null,
      removeFallback: null,
    };
  }
  return g[SLOT_KEY];
}

function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

function readEffectiveType(): string | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  return nav.connection?.effectiveType ?? null;
}

function toSample(status: { connected: boolean; connectionType: string }): NetworkSample {
  return {
    connected: status.connected,
    connectionType: status.connectionType,
    effectiveType: readEffectiveType(),
  };
}

let state: ConnectivityState = initialConnectivityState();
let starting: Promise<void> | null = null;

function applyStep(step: { state: ConnectivityState; reachabilityChanged: boolean }): void {
  const slot = networkSlot();
  state = step.state;
  publishLink(state.published);
  if (step.reachabilityChanged) {
    slot.setOnline?.(state.published.reachability === "online");
  }
  if (slot.timer != null) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  const delay = connectivityDelayMs(state, Date.now());
  if (delay == null) return;
  slot.timer = setTimeout(() => {
    networkSlot().timer = null;
    applyStep(reduceConnectivityTick(state, Date.now()));
  }, delay);
}

function applySample(sample: NetworkSample, mode: "initial" | "live"): void {
  applyStep(reduceConnectivitySample(state, sample, Date.now(), mode));
}

function installNavigatorFallback(): void {
  if (typeof window === "undefined") return;
  const slot = networkSlot();
  const onOnline = () => applySample(sampleFromNavigator(true), "live");
  const onOffline = () => applySample(sampleFromNavigator(false), "live");
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  slot.removeFallback = () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
  applySample(sampleFromNavigator(typeof navigator !== "undefined" && navigator.onLine), "initial");
}

async function startAndroidNetwork(): Promise<void> {
  const slot = networkSlot();
  if (slot.installed) return;
  slot.installed = true;

  onlineManager.setEventListener((setOnline) => {
    networkSlot().setOnline = setOnline;
    return () => {
      networkSlot().setOnline = null;
    };
  });

  try {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    applySample(toSample(status), "initial");
    const handle = await Network.addListener("networkStatusChange", (next) => {
      applySample(toSample(next), "live");
    });
    networkSlot().removePlugin = () => {
      void handle.remove();
    };
  } catch (error) {
    console.error("[network] Capacitor Network unavailable, using navigator.onLine", error);
    installNavigatorFallback();
  }
}

/**
 * Resolve the first native sample before React renders when it returns
 * quickly. A stuck plugin call must not hold the splash: after 1.5s the
 * app boots and the sample applies when it arrives.
 */
export function primeAndroidNetworkStatus(): Promise<void> {
  if (!isAndroidNative()) return Promise.resolve();
  if (!starting) starting = startAndroidNetwork();
  return Promise.race([
    starting,
    new Promise<void>((resolve) => {
      setTimeout(resolve, PRIME_TIMEOUT_MS);
    }),
  ]);
}
