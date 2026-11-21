/**
 * Gating and scroll math for the one-off "hide cards like this" hint.
 *
 * Testing override (signed-in only, still waits for a qualifying card):
 *   ?hint=hide
 *   localStorage voxdex_force_hide_hint = "1"
 * The override skips the 7-day cooldown, the first-session gate, the
 * "already hid a card" gate, and the short quiet period after the
 * interests drawer closes. It still stays quiet while that drawer is open.
 */

export const HIDE_HINT_COPY = "Not your thing? Tap here to hide cards like this.";

/** localStorage value that forces the hint onto the next qualifying card. */
export const HIDE_HINT_FORCE_STORAGE_KEY = "voxdex_force_hide_hint";

/** Cards that must leave the view before the next in-view card can hint. */
export const HIDE_HINT_CARDS_TO_PASS = 3;

export const HIDE_HINT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** How long the bubble stays up before it fades, if nothing dismisses it. */
export const HIDE_HINT_VISIBLE_MS = 4_000;

/**
 * After the interests drawer closes, keep the hint down briefly so it does
 * not appear in the same breath. Forced mode skips this window.
 */
export const HIDE_HINT_RECOMMENDATIONS_QUIET_MS = 60_000;

/** A card counts as seen once this much of it is inside the viewport. */
export const HIDE_HINT_ENTER_RATIO = 0.4;

export interface HideHintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HideHintStores {
  local: HideHintStorage;
  session: HideHintStorage;
}

export type HideHintGateReason =
  | "signed-out"
  | "forced"
  | "has-hidden"
  | "recommendations"
  | "first-visit"
  | "cooldown"
  | "eligible";

export interface HideHintGateInput {
  signedIn: boolean;
  userId: string | null;
  now: number;
  /** `window.location.search`, including the leading `?` when present. */
  search: string;
  /** True when the hidden-cards query (or an in-memory latch) is non-empty. */
  hasHiddenCards: boolean;
  /** Interests picker is currently open (either copy). */
  recommendationsOpen: boolean;
  /** When the interests drawer last closed, or null if it has not closed. */
  recommendationsClosedAt: number | null;
  stores: HideHintStores;
}

export interface HideHintGateResult {
  eligible: boolean;
  reason: HideHintGateReason;
}

export interface HideHintRecommendationsState {
  open: boolean;
  /** ms timestamp of the last open → closed transition, or null. */
  closedAt: number | null;
}

const recommendationListeners = new Set<() => void>();
let recommendations: HideHintRecommendationsState = {
  open: false,
  closedAt: null,
};
let quietTimer: number | null = null;

function firstSeenKey(userId: string): string {
  return `voxdex_hide_hint_first_seen:${userId}`;
}

function introSessionKey(userId: string): string {
  return `voxdex_hide_hint_intro_session:${userId}`;
}

function shownAtKey(userId: string): string {
  return `voxdex_hide_hint_shown_at:${userId}`;
}

function hasHiddenKey(userId: string): string {
  return `voxdex_hide_hint_has_hidden:${userId}`;
}

function safeGet(storage: HideHintStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: HideHintStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* private mode or quota */
  }
}

export function normalizeHideHintPath(path: string): string {
  const bare = path.split("?")[0]?.split("#")[0] ?? "";
  if (bare.length > 1 && bare.endsWith("/")) return bare.slice(0, -1);
  return bare;
}

/** Live chip menus on the vote and predict hubs. Detail routes are excluded. */
export function isHideHintFeedPath(path: string): boolean {
  const normalized = normalizeHideHintPath(path);
  return normalized === "/vote" || normalized === "/predict";
}

export function isHideHintForced(search: string, local: HideHintStorage): boolean {
  if (safeGet(local, HIDE_HINT_FORCE_STORAGE_KEY) === "1") return true;
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw).get("hint") === "hide";
}

export function readHideHintHasHiddenFlag(userId: string, storage: HideHintStorage): boolean {
  return safeGet(storage, hasHiddenKey(userId)) === "1";
}

export function markHideHintHasHidden(userId: string, storage?: HideHintStorage): void {
  const target = storage ?? browserStorage("local");
  if (!target) return;
  safeSet(target, hasHiddenKey(userId), "1");
}

export function markHideHintShown(userId: string, now: number, storage?: HideHintStorage): void {
  const target = storage ?? browserStorage("local");
  if (!target) return;
  safeSet(target, shownAtKey(userId), String(now));
}

function browserStorage(kind: "local" | "session"): HideHintStorage | null {
  try {
    return kind === "local" ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Records the first-seen marker. The session that writes it is the intro
 * session and cannot show the hint (unless the testing override is on).
 */
function noteIntro(
  userId: string,
  now: number,
  stores: HideHintStores,
): "first" | "returning" {
  const seen = safeGet(stores.local, firstSeenKey(userId));
  if (!seen) {
    safeSet(stores.local, firstSeenKey(userId), String(now));
    safeSet(stores.session, introSessionKey(userId), "1");
    return "first";
  }
  if (safeGet(stores.session, introSessionKey(userId)) === "1") return "first";
  return "returning";
}

function withinCooldown(userId: string, now: number, local: HideHintStorage): boolean {
  const raw = safeGet(local, shownAtKey(userId));
  if (!raw) return false;
  const shown = Number(raw);
  if (!Number.isFinite(shown) || shown <= 0) return false;
  return now - shown < HIDE_HINT_COOLDOWN_MS;
}

export function evaluateHideHintGate(input: HideHintGateInput): HideHintGateResult {
  if (!input.signedIn || !input.userId) {
    return { eligible: false, reason: "signed-out" };
  }

  // Stamp the first visit even when a later gate blocks, so the next
  // session is not treated as the first one. The testing override still
  // skips the first-session result itself.
  const intro = noteIntro(input.userId, input.now, input.stores);
  const forced = isHideHintForced(input.search, input.stores.local);
  const hidden =
    input.hasHiddenCards || readHideHintHasHiddenFlag(input.userId, input.stores.local);

  if (input.recommendationsOpen) {
    return { eligible: false, reason: "recommendations" };
  }
  // Forced mode skips the post-close quiet window along with the other
  // frequency gates. It still waits while the drawer is actually open.
  if (forced) return { eligible: true, reason: "forced" };
  if (recommendationsRecentlyClosed(input)) {
    return { eligible: false, reason: "recommendations" };
  }
  if (hidden) return { eligible: false, reason: "has-hidden" };
  if (intro === "first") return { eligible: false, reason: "first-visit" };
  if (withinCooldown(input.userId, input.now, input.stores.local)) {
    return { eligible: false, reason: "cooldown" };
  }
  return { eligible: true, reason: "eligible" };
}

function recommendationsRecentlyClosed(input: HideHintGateInput): boolean {
  if (input.recommendationsClosedAt == null) return false;
  return input.now - input.recommendationsClosedAt < HIDE_HINT_RECOMMENDATIONS_QUIET_MS;
}

function clearQuietTimer(): void {
  if (quietTimer == null) return;
  window.clearTimeout(quietTimer);
  quietTimer = null;
}

/** Notify listeners when the post-close quiet window ends, so a streak that is already met can show. */
function armQuietTimer(now: number): void {
  clearQuietTimer();
  if (recommendations.open || recommendations.closedAt == null) return;
  const remaining = HIDE_HINT_RECOMMENDATIONS_QUIET_MS - (now - recommendations.closedAt);
  if (remaining <= 0 || typeof window === "undefined") return;
  quietTimer = window.setTimeout(() => {
    quietTimer = null;
    recommendationListeners.forEach((listener) => listener());
  }, remaining);
}

export function setHideHintRecommendations(next: { open: boolean }, now = Date.now()): void {
  let closedAt = recommendations.closedAt;
  if (recommendations.open && !next.open) {
    closedAt = now;
  }
  if (recommendations.open === next.open && recommendations.closedAt === closedAt) {
    return;
  }
  recommendations = { open: next.open, closedAt };
  recommendationListeners.forEach((listener) => listener());
  armQuietTimer(now);
}

export function getHideHintRecommendations(): HideHintRecommendationsState {
  return recommendations;
}

export function subscribeHideHintRecommendations(listener: () => void): () => void {
  recommendationListeners.add(listener);
  return () => {
    recommendationListeners.delete(listener);
  };
}

export function resetHideHintRecommendationsForTests(): void {
  clearQuietTimer();
  recommendations = { open: false, closedAt: null };
  recommendationListeners.clear();
}

export interface HideHintScrollState {
  passed: string[];
  visible: string[];
  consumed: boolean;
}

export type HideHintScrollEvent =
  | { type: "enter"; cardId: string }
  | { type: "pass"; cardId: string }
  | { type: "vote" }
  | { type: "consume" };

export function initialHideHintScrollState(): HideHintScrollState {
  return { passed: [], visible: [], consumed: false };
}

export function reduceHideHintScroll(
  state: HideHintScrollState,
  event: HideHintScrollEvent,
): HideHintScrollState {
  switch (event.type) {
    case "enter": {
      if (state.visible.includes(event.cardId)) return state;
      return { ...state, visible: [...state.visible, event.cardId] };
    }
    case "pass": {
      if (!state.visible.includes(event.cardId)) return state;
      const visible = state.visible.filter((id) => id !== event.cardId);
      if (state.consumed || state.passed.includes(event.cardId)) {
        return { ...state, visible };
      }
      return { ...state, visible, passed: [...state.passed, event.cardId] };
    }
    case "vote": {
      if (state.passed.length === 0) return state;
      return { ...state, passed: [] };
    }
    case "consume": {
      if (state.consumed) return state;
      return { ...state, consumed: true };
    }
    default:
      return state;
  }
}

/** The in-view card that should carry the hint, once enough cards have passed. */
export function hideHintTargetCard(state: HideHintScrollState): string | null {
  if (state.consumed || state.passed.length < HIDE_HINT_CARDS_TO_PASS) return null;
  const passed = new Set(state.passed);
  for (const id of state.visible) {
    if (!passed.has(id)) return id;
  }
  return null;
}

export function classifyHideHintIntersection(input: {
  isIntersecting: boolean;
  ratio: number;
  wasVisible: boolean;
}): "enter" | "pass" | "ignore" {
  const seen = input.isIntersecting && input.ratio >= HIDE_HINT_ENTER_RATIO;
  if (seen) return "enter";
  if (input.wasVisible && !input.isIntersecting) return "pass";
  return "ignore";
}

export interface HideHintBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface HideHintPlacement {
  top: number;
  left: number;
  width: number;
  placement: "above" | "below";
  /** Arrow centre, measured from the bubble's left edge. */
  arrowX: number;
}

function boxRight(box: HideHintBox): number {
  return box.left + box.width;
}

function boxBottom(box: HideHintBox): number {
  return box.top + box.height;
}

function boxesOverlap(a: HideHintBox, b: HideHintBox, pad = 4): boolean {
  return boxRight(a) > b.left - pad
    && a.left < boxRight(b) + pad
    && boxBottom(a) > b.top - pad
    && a.top < boxBottom(b) + pad;
}

function hitsAny(box: HideHintBox, obstacles: readonly HideHintBox[]): boolean {
  return obstacles.some((obstacle) => boxesOverlap(box, obstacle));
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Place the bubble beside the chip. It stays inside the viewport, prefers
 * to sit just under the chip, and flips above when that would cover a vote
 * control or run off the bottom.
 */
export function placeHideHintBubble(input: {
  anchor: HideHintBox;
  bubbleWidth: number;
  bubbleHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  obstacles?: readonly HideHintBox[];
  margin?: number;
  topInset?: number;
  bottomInset?: number;
}): HideHintPlacement {
  const margin = input.margin ?? 8;
  const topInset = input.topInset ?? margin;
  const bottomInset = input.bottomInset ?? margin;
  const gap = 8;
  const width = Math.min(input.bubbleWidth, Math.max(0, input.viewportWidth - margin * 2));
  const height = input.bubbleHeight;
  const anchorRight = boxRight(input.anchor);
  const anchorBottom = boxBottom(input.anchor);
  const left = clamp(anchorRight - width, margin, input.viewportWidth - margin - width);
  const maxTop = Math.max(topInset, input.viewportHeight - bottomInset - height);
  const obstacles = input.obstacles ?? [];

  const belowTop = anchorBottom + gap;
  const aboveTop = input.anchor.top - gap - height;
  const belowBox: HideHintBox = { top: belowTop, left, width, height };
  const aboveBox: HideHintBox = { top: aboveTop, left, width, height };
  const belowFits = belowTop >= topInset && belowTop + height <= input.viewportHeight - bottomInset;
  const aboveFits = aboveTop >= topInset && aboveTop + height <= input.viewportHeight - bottomInset;
  const belowClear = belowFits && !hitsAny(belowBox, obstacles);
  const aboveClear = aboveFits && !hitsAny(aboveBox, obstacles);

  let placement: "above" | "below" = "below";
  let top = belowTop;
  if (belowClear) {
    placement = "below";
    top = belowTop;
  } else if (aboveClear) {
    placement = "above";
    top = aboveTop;
  } else if (!hitsAny(aboveBox, obstacles) && hitsAny(belowBox, obstacles)) {
    placement = "above";
    top = aboveTop;
  } else if (hitsAny(aboveBox, obstacles) && !hitsAny(belowBox, obstacles)) {
    placement = "below";
    top = belowTop;
  } else {
    const spaceAbove = input.anchor.top - topInset - gap;
    const spaceBelow = input.viewportHeight - bottomInset - anchorBottom - gap;
    if (spaceAbove > spaceBelow) {
      placement = "above";
      top = aboveTop;
    }
  }

  top = clamp(top, topInset, maxTop);

  let guard = 0;
  while (guard < 12 && hitsAny({ top, left, width, height }, obstacles)) {
    const next = placement === "below" ? top - 8 : top + 8;
    const clamped = clamp(next, topInset, maxTop);
    if (clamped === top) break;
    top = clamped;
    guard += 1;
  }

  const anchorCenter = input.anchor.left + input.anchor.width / 2;
  const arrowX = clamp(anchorCenter - left, 14, Math.max(14, width - 14));
  return { top, left, width, placement, arrowX };
}
