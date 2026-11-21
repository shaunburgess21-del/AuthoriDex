/**
 * One shared IntersectionObserver for live category chips on /vote and /predict.
 * Snap view and Quick Vote never register: their chip menus are disabled.
 */

import { queryClient, apiRequest } from "@/lib/queryClient";
import { HIDDEN_CARDS_QUERY_KEY } from "@/lib/hiddenCardCache";
import { onHideHintVote } from "@/lib/hideHintSignals";
import {
  classifyHideHintIntersection,
  evaluateHideHintGate,
  getHideHintRecommendations,
  hideHintTargetCard,
  initialHideHintScrollState,
  isHideHintForced,
  markHideHintHasHidden,
  markHideHintShown,
  readHideHintHasHiddenFlag,
  reduceHideHintScroll,
  subscribeHideHintRecommendations,
  type HideHintScrollState,
  type HideHintStorage,
} from "@/lib/hideHintGate";

const SETTLE_MS = 280;

export interface HideHintSurface {
  signedIn: boolean;
  userId: string;
  path: string;
}

export interface HideHintDisplay {
  cardId: string | null;
  element: Element | null;
}

interface Target {
  cardId: string;
  element: Element;
  wasVisible: boolean;
}

const displayListeners = new Set<() => void>();
let published: HideHintDisplay = { cardId: null, element: null };

const targets = new Map<Element, Target>();
let scroll: HideHintScrollState = initialHideHintScrollState();
let observer: IntersectionObserver | null = null;
let viewers = 0;
let surface: HideHintSurface | null = null;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let hiddenLatch = false;
let prefetchedFor: string | null = null;
let stopRecommendations: (() => void) | null = null;
let stopHiddenCache: (() => void) | null = null;
let stopVotes: (() => void) | null = null;

const safeLocal: HideHintStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

const safeSession: HideHintStorage = {
  getItem: (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

export function subscribeHideHintDisplay(listener: () => void): () => void {
  displayListeners.add(listener);
  return () => {
    displayListeners.delete(listener);
  };
}

export function getHideHintDisplay(): HideHintDisplay {
  return published;
}

function publish(next: HideHintDisplay): void {
  if (next.cardId === published.cardId && next.element === published.element) return;
  published = next;
  displayListeners.forEach((listener) => listener());
}

function clearSettle(): void {
  if (settleTimer == null) return;
  clearTimeout(settleTimer);
  settleTimer = null;
}

function clearDisplayed(): void {
  clearSettle();
  publish({ cardId: null, element: null });
}

function hiddenQueryNonEmpty(): boolean {
  const data = queryClient.getQueryData<{ data?: unknown[] }>(HIDDEN_CARDS_QUERY_KEY);
  return Array.isArray(data?.data) && data.data.length > 0;
}

function viewerHasHidden(): boolean {
  if (!surface?.userId) return false;
  if (hiddenLatch || readHideHintHasHiddenFlag(surface.userId, safeLocal)) {
    hiddenLatch = true;
    return true;
  }
  if (hiddenQueryNonEmpty()) {
    hiddenLatch = true;
    markHideHintHasHidden(surface.userId, safeLocal);
    return true;
  }
  return false;
}

function gateAllows(): boolean {
  if (!surface?.signedIn || !surface.userId) return false;
  const recommendations = getHideHintRecommendations();
  const result = evaluateHideHintGate({
    signedIn: true,
    userId: surface.userId,
    now: Date.now(),
    search: typeof window !== "undefined" ? window.location.search : "",
    hasHiddenCards: viewerHasHidden(),
    recommendationsOpen: recommendations.open,
    recommendationsShownThisSession: recommendations.shownThisSession,
    stores: { local: safeLocal, session: safeSession },
  });
  return result.eligible;
}

function anotherElementStillVisible(cardId: string, except: Element): boolean {
  for (const target of targets.values()) {
    if (target.element === except) continue;
    if (target.cardId === cardId && target.wasVisible) return true;
  }
  return false;
}

function applyScroll(event: Parameters<typeof reduceHideHintScroll>[1]): void {
  const next = reduceHideHintScroll(scroll, event);
  if (next === scroll) return;
  scroll = next;
  scheduleDisplay();
}

function onEntries(entries: IntersectionObserverEntry[]): void {
  let changed = false;
  for (const entry of entries) {
    const target = targets.get(entry.target);
    if (!target) continue;
    const kind = classifyHideHintIntersection({
      isIntersecting: entry.isIntersecting,
      ratio: entry.intersectionRatio,
      wasVisible: target.wasVisible,
    });
    if (kind === "enter") {
      if (target.wasVisible) continue;
      target.wasVisible = true;
      const next = reduceHideHintScroll(scroll, { type: "enter", cardId: target.cardId });
      if (next !== scroll) {
        scroll = next;
        changed = true;
      }
      continue;
    }
    if (kind === "pass") {
      target.wasVisible = false;
      if (anotherElementStillVisible(target.cardId, target.element)) continue;
      const next = reduceHideHintScroll(scroll, { type: "pass", cardId: target.cardId });
      if (next !== scroll) {
        scroll = next;
        changed = true;
      }
    }
  }
  if (changed) scheduleDisplay();
}

function ensureObserver(): void {
  if (observer || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver(onEntries, { threshold: [0, 0.4, 0.75] });
}

function chipIsUncovered(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (typeof document === "undefined" || typeof document.elementFromPoint !== "function") return true;
  const x = Math.min(window.innerWidth - 1, Math.max(1, rect.left + rect.width / 2));
  const y = Math.min(window.innerHeight - 1, Math.max(1, rect.top + rect.height / 2));
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === element || element.contains(hit));
}

function findUncoveredAnchor(cardId: string): Element | null {
  for (const target of targets.values()) {
    if (target.cardId !== cardId) continue;
    if (chipIsUncovered(target.element)) return target.element;
  }
  return null;
}

function hiddenLookupSettled(): boolean {
  const state = queryClient.getQueryState(HIDDEN_CARDS_QUERY_KEY);
  return state?.status === "success" || state?.status === "error";
}

function tryShow(): void {
  if (published.cardId || scroll.consumed) return;
  if (!gateAllows() || !surface?.userId) return;
  const search = typeof window !== "undefined" ? window.location.search : "";
  // Wait for the hidden-cards read so a returning hider doesn't flash the hint.
  // The testing override ignores that gate and may show immediately.
  if (!isHideHintForced(search, safeLocal) && !hiddenLookupSettled() && !hiddenLatch) return;
  const cardId = hideHintTargetCard(scroll);
  if (!cardId) return;
  const element = findUncoveredAnchor(cardId);
  if (!element) return;
  markHideHintShown(surface.userId, Date.now(), safeLocal);
  scroll = reduceHideHintScroll(scroll, { type: "consume" });
  publish({ cardId, element });
}

function scheduleDisplay(): void {
  if (published.cardId || scroll.consumed) return;
  if (!hideHintTargetCard(scroll)) {
    clearSettle();
    return;
  }
  clearSettle();
  settleTimer = setTimeout(() => {
    settleTimer = null;
    tryShow();
  }, SETTLE_MS);
}

function onGateInputsChanged(): void {
  if (!gateAllows()) {
    clearSettle();
    if (published.cardId) {
      scroll = reduceHideHintScroll(scroll, { type: "consume" });
      clearDisplayed();
    }
    return;
  }
  scheduleDisplay();
}

function onVote(): void {
  scroll = reduceHideHintScroll(scroll, { type: "vote" });
  if (published.cardId) {
    scroll = reduceHideHintScroll(scroll, { type: "consume" });
    clearDisplayed();
    return;
  }
  scheduleDisplay();
}

function ensureHiddenCards(userId: string): void {
  if (prefetchedFor === userId) return;
  prefetchedFor = userId;
  void queryClient.prefetchQuery({
    queryKey: HIDDEN_CARDS_QUERY_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/hidden-cards");
      return res.json();
    },
  }).then(() => {
    onGateInputsChanged();
  }).catch(() => {
    /* The local flag still blocks once a hide has succeeded on this device. */
  });
}

function start(): void {
  ensureObserver();
  stopRecommendations = subscribeHideHintRecommendations(onGateInputsChanged);
  stopHiddenCache = queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] !== HIDDEN_CARDS_QUERY_KEY[0]) return;
    onGateInputsChanged();
  });
  stopVotes = onHideHintVote(onVote);
}

function stop(): void {
  stopRecommendations?.();
  stopHiddenCache?.();
  stopVotes?.();
  stopRecommendations = null;
  stopHiddenCache = null;
  stopVotes = null;
  clearSettle();
  observer?.disconnect();
  observer = null;
  targets.clear();
  scroll = initialHideHintScrollState();
  surface = null;
  hiddenLatch = false;
  clearDisplayed();
}

export function retainHideHintSurface(next: HideHintSurface): () => void {
  const pathChanged = !!surface && surface.path !== next.path;
  surface = next;
  if (pathChanged) {
    scroll = initialHideHintScrollState();
    clearDisplayed();
  }
  if (viewers === 0) start();
  viewers += 1;
  if (next.signedIn && next.userId) ensureHiddenCards(next.userId);
  // Record the first-seen marker as soon as a signed-in feed is on screen.
  gateAllows();
  return () => {
    viewers = Math.max(0, viewers - 1);
    if (viewers > 0) return;
    stop();
  };
}

export function registerHideHintCard(cardId: string, element: Element): () => void {
  const target: Target = { cardId, element, wasVisible: false };
  targets.set(element, target);
  ensureObserver();
  observer?.observe(element);
  return () => {
    const current = targets.get(element);
    if (!current) return;
    const wasVisible = current.wasVisible;
    targets.delete(element);
    observer?.unobserve(element);
    if (!wasVisible || targets.size === 0) return;
    if (anotherElementStillVisible(cardId, element)) return;
    applyScroll({ type: "pass", cardId });
  };
}

/** Hide succeeded. Stop the hint on this device even if the list query is stale. */
export function noteHideHintCardHidden(): void {
  hiddenLatch = true;
  if (!published.cardId) {
    clearSettle();
    return;
  }
  scroll = reduceHideHintScroll(scroll, { type: "consume" });
  clearDisplayed();
}

export function dismissHideHintDisplay(): void {
  scroll = reduceHideHintScroll(scroll, { type: "consume" });
  clearDisplayed();
}
