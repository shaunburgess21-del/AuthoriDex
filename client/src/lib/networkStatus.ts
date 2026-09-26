/**
 * Connectivity decisions for the Android shell and for request failures.
 *
 * Pure on purpose: the Capacitor Network listener and the React banner
 * both call these helpers, and unit tests cover them without a WebView.
 *
 * Poor links (effectiveType 2g / slow-2g) stay fetchable. Pausing queries
 * or pinning a banner on a slow radio would freeze the app and flap.
 * Only a confirmed offline link pauses fetches and shows the banner.
 *
 * Website and PWA keep TanStack Query's own `navigator.onLine` listener.
 * Nothing here calls `onlineManager` — that stays in the Android listener.
 */

export const OFFLINE_CONFIRM_MS = 400;
export const ONLINE_CONFIRM_MS = 750;
export const RESTORED_BANNER_MS = 2200;

export type LinkQuality = "online" | "poor" | "offline";
export type Reachability = "online" | "offline";
export type BannerPhase = "hidden" | "offline" | "restored";
export type QueryStatus = "pending" | "error" | "success";
export type QueryFetchStatus = "fetching" | "paused" | "idle";

export interface NetworkSample {
  connected: boolean;
  connectionType: string;
  /** Network Information API `effectiveType`, when the WebView exposes it. */
  effectiveType?: string | null;
}

export interface PublishedLink {
  reachability: Reachability;
  quality: LinkQuality;
  banner: BannerPhase;
}

export const ONLINE_LINK: PublishedLink = {
  reachability: "online",
  quality: "online",
  banner: "hidden",
};

export interface ConnectivityState {
  published: PublishedLink;
  rawReachability: Reachability;
  rawQuality: LinkQuality;
  pendingReachability: Reachability | null;
  pendingSince: number | null;
  restoredUntil: number | null;
}

export interface ConnectivityStep {
  state: ConnectivityState;
  /** True only when published reachability flips. One refetch, not a loop. */
  reachabilityChanged: boolean;
}

export function initialConnectivityState(): ConnectivityState {
  return {
    published: ONLINE_LINK,
    rawReachability: "online",
    rawQuality: "online",
    pendingReachability: null,
    pendingSince: null,
    restoredUntil: null,
  };
}

export function classifyLink(sample: NetworkSample): LinkQuality {
  if (!sample.connected || sample.connectionType === "none") return "offline";
  const effective = sample.effectiveType ?? "";
  if (effective === "slow-2g" || effective === "2g") return "poor";
  return "online";
}

export function reachabilityFor(quality: LinkQuality): Reachability {
  return quality === "offline" ? "offline" : "online";
}

export function sampleFromNavigator(onLine: boolean): NetworkSample {
  return {
    connected: onLine,
    connectionType: onLine ? "unknown" : "none",
  };
}

function withPublished(
  state: ConnectivityState,
  published: PublishedLink,
  extra: Partial<ConnectivityState> = {},
): ConnectivityState {
  return {
    ...state,
    ...extra,
    published,
  };
}

export function reduceConnectivitySample(
  state: ConnectivityState,
  sample: NetworkSample,
  now: number,
  mode: "initial" | "live",
): ConnectivityStep {
  const quality = classifyLink(sample);
  const reachability = reachabilityFor(quality);

  if (mode === "initial") {
    const banner: BannerPhase = reachability === "offline" ? "offline" : "hidden";
    const next = withPublished(
      state,
      { reachability, quality, banner },
      {
        rawReachability: reachability,
        rawQuality: quality,
        pendingReachability: null,
        pendingSince: null,
        restoredUntil: null,
      },
    );
    return {
      state: next,
      reachabilityChanged: reachability !== state.published.reachability,
    };
  }

  // Back on the link we already published: drop a half-finished flap.
  if (reachability === state.published.reachability) {
    return {
      state: withPublished(
        state,
        { ...state.published, quality },
        {
          rawReachability: reachability,
          rawQuality: quality,
          pendingReachability: null,
          pendingSince: null,
        },
      ),
      reachabilityChanged: false,
    };
  }

  if (state.pendingReachability === reachability && state.pendingSince != null) {
    return {
      state: {
        ...state,
        rawReachability: reachability,
        rawQuality: quality,
      },
      reachabilityChanged: false,
    };
  }

  return {
    state: {
      ...state,
      rawReachability: reachability,
      rawQuality: quality,
      pendingReachability: reachability,
      pendingSince: now,
    },
    reachabilityChanged: false,
  };
}

export function reduceConnectivityTick(state: ConnectivityState, now: number): ConnectivityStep {
  let next = state;
  let reachabilityChanged = false;

  if (next.pendingReachability != null && next.pendingSince != null) {
    const delay = next.pendingReachability === "offline" ? OFFLINE_CONFIRM_MS : ONLINE_CONFIRM_MS;
    if (now - next.pendingSince >= delay) {
      const reachability = next.pendingReachability;
      const was = next.published.reachability;
      let banner: BannerPhase = "hidden";
      let restoredUntil: number | null = null;
      if (reachability === "offline") {
        banner = "offline";
      } else if (was === "offline") {
        banner = "restored";
        restoredUntil = now + RESTORED_BANNER_MS;
      }
      next = withPublished(
        next,
        { reachability, quality: next.rawQuality, banner },
        {
          pendingReachability: null,
          pendingSince: null,
          restoredUntil,
        },
      );
      reachabilityChanged = reachability !== was;
    }
  }

  if (
    next.restoredUntil != null &&
    now >= next.restoredUntil &&
    next.published.banner === "restored"
  ) {
    next = withPublished(
      next,
      { ...next.published, banner: "hidden" },
      { restoredUntil: null },
    );
  }

  return { state: next, reachabilityChanged };
}

/** Milliseconds until the next tick, or null when the state is idle. */
export function connectivityDelayMs(state: ConnectivityState, now: number): number | null {
  const times: number[] = [];
  if (state.pendingSince != null && state.pendingReachability != null) {
    const delay = state.pendingReachability === "offline" ? OFFLINE_CONFIRM_MS : ONLINE_CONFIRM_MS;
    times.push(state.pendingSince + delay - now);
  }
  if (state.restoredUntil != null && state.published.banner === "restored") {
    times.push(state.restoredUntil - now);
  }
  if (times.length === 0) return null;
  return Math.max(0, Math.min(...times));
}

const publishedListeners = new Set<(link: PublishedLink) => void>();
let publishedLink: PublishedLink = ONLINE_LINK;

export function getPublishedLink(): PublishedLink {
  return publishedLink;
}

export function getPublishedReachability(): Reachability {
  return publishedLink.reachability;
}

export function publishLink(next: PublishedLink): void {
  if (
    next.reachability === publishedLink.reachability &&
    next.quality === publishedLink.quality &&
    next.banner === publishedLink.banner
  ) {
    return;
  }
  publishedLink = next;
  publishedListeners.forEach((listener) => listener(next));
}

export function subscribePublishedLink(listener: (link: PublishedLink) => void): () => void {
  publishedListeners.add(listener);
  return () => {
    publishedListeners.delete(listener);
  };
}

export function resetPublishedLinkForTests(): void {
  publishedLink = ONLINE_LINK;
  publishedListeners.clear();
}

const TRANSPORT_NAMES = new Set(["TypeError", "NetworkError"]);

/**
 * Browser fetch failures, not HTTP errors our code wraps as `Error`.
 * Home throws `new Error("Failed to fetch")` for a non-OK response — that
 * must stay a server error, not an offline state.
 */
export function isTransportFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err && typeof err.name === "string" ? err.name : "";
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (!TRANSPORT_NAMES.has(name)) return false;
  return /failed to fetch|load failed|networkerror|network request failed|internet connection|the network connection was lost/i.test(
    message,
  );
}

export function transportFailureDescription(): string {
  return getPublishedReachability() === "offline"
    ? "You're offline. Try again when you reconnect."
    : "Check your connection and try again.";
}

export type OfflineNoticeKind = "offline" | "unreachable";

export function offlineNoticeCopy(kind: OfflineNoticeKind): { title: string; detail: string } {
  if (kind === "offline") {
    return {
      title: "You're offline",
      detail: "This will load when you reconnect.",
    };
  }
  return {
    title: "Can't reach VoxDex",
    detail: "Check your connection and try again.",
  };
}

/**
 * A paused first fetch has no payload, and `isLoading` is false in
 * TanStack Query v5, so lists fall through to "no results". Only treat
 * that as offline when we have positively published an offline link.
 * A backgrounded tab also pauses fetches, and that must stay a spinner
 * or the existing empty state on the website.
 * A successful empty payload stays empty — that list really is empty.
 */
export function shouldReplaceEmptyWithOffline(input: {
  status: QueryStatus;
  fetchStatus: QueryFetchStatus;
  transportError: boolean;
  offline: boolean;
}): OfflineNoticeKind | null {
  const paused = input.fetchStatus === "paused";
  if (input.status === "pending" && paused && input.offline) return "offline";
  if (input.status === "error" && input.transportError) {
    return input.offline ? "offline" : "unreachable";
  }
  return null;
}
