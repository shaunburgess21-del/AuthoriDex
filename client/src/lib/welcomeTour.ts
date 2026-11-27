import { useSyncExternalStore } from "react";

/**
 * New-user welcome tour on /vote. Frontend only, once per device.
 *
 * The tour never starts by itself. A preview tap, the checklist's
 * "Show me how" control, or a replay link queues a request. Skip and
 * completion both write the seen flag. A practice tap is a local choice:
 * it does not call a vote API, the anon budget, credits, XP, or scoring.
 */

export const WELCOME_TOUR_SEEN_KEY = "voxdex_welcome_tour_seen";

export const WELCOME_TOUR_PENDING_KEY = "voxdex_welcome_tour_pending";

/** Set when a tour starts, until the next real vote is logged. */
export const WELCOME_TOUR_REAL_VOTE_PENDING_KEY = "voxdex_welcome_tour_real_vote_pending";

/** Set after tour_first_real_vote so a replay cannot log it again. */
export const WELCOME_TOUR_REAL_VOTE_LOGGED_KEY = "voxdex_welcome_tour_real_vote_logged";

export const WELCOME_TOUR_CARD_ATTR = "data-welcome-tour-h2h";

/** How long to wait for a head-to-head card before the quick tour. */
export const PRACTICE_CARD_WAIT_MS = 2500;

export const TOUR_SOURCES = ["preview", "link", "replay"] as const;

export type TourSource = (typeof TOUR_SOURCES)[number];

export const PRACTICE_STEPS = ["practice_tap", "practice_reveal", "your_turn"] as const;

export const QUICK_TOUR_STEPS = ["categories", "predict", "rankings", "ready"] as const;

export const TOUR_STEPS = [...PRACTICE_STEPS, ...QUICK_TOUR_STEPS] as const;

export type TourStepId = (typeof TOUR_STEPS)[number];

export const PREDICT_NAV_TEST_IDS = ["nav-predict", "nav-predict-desktop"] as const;

export const RANKINGS_NAV_TEST_IDS = ["nav-rankings", "nav-rankings-desktop"] as const;

export const CATEGORY_BAND_TEST_ID = "vote-sticky-band";

export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PracticeSplit {
  a: number;
  b: number;
}

export interface RunningTour {
  status: "running";
  source: TourSource;
  steps: readonly TourStepId[];
  index: number;
  side: "a" | "b" | null;
  split: PracticeSplit | null;
}

export type TourPhase =
  | { status: "idle" }
  | { status: "seeking"; source: TourSource }
  | RunningTour
  | { status: "done" };

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RectBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface BubblePlacement {
  top: number;
  left: number;
  width: number;
  side: "top" | "bottom";
}

const activeListeners = new Set<() => void>();
const requestListeners = new Set<() => void>();

let tourActive = false;
let queuedSource: TourSource | null = null;

export function isTourSource(value: unknown): value is TourSource {
  return value === "preview" || value === "link" || value === "replay";
}

/** The tour is opt-in. Seen or not, nothing opens it on its own. */
export function shouldAutoStartTour(): boolean {
  return false;
}

function readFlag(storage: Pick<TourStorage, "getItem">, key: string): boolean {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: Pick<TourStorage, "setItem">, key: string): void {
  try {
    storage.setItem(key, "1");
  } catch {
    /* private mode / quota */
  }
}

function clearFlag(storage: Pick<TourStorage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function readTourSeen(storage: Pick<TourStorage, "getItem">): boolean {
  return readFlag(storage, WELCOME_TOUR_SEEN_KEY);
}

/** Skip and completion both count as seen. */
export function writeTourSeen(storage: Pick<TourStorage, "setItem">): void {
  writeFlag(storage, WELCOME_TOUR_SEEN_KEY);
}

export function writeTourPending(storage: Pick<TourStorage, "setItem">, source: TourSource): void {
  try {
    storage.setItem(WELCOME_TOUR_PENDING_KEY, source);
  } catch {
    /* private mode */
  }
}

export function readTourPending(storage: Pick<TourStorage, "getItem">): TourSource | null {
  try {
    const value = storage.getItem(WELCOME_TOUR_PENDING_KEY);
    return isTourSource(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearTourPending(storage: Pick<TourStorage, "removeItem">): void {
  clearFlag(storage, WELCOME_TOUR_PENDING_KEY);
}

/**
 * Arm the one-time real-vote event. A replay after it has been logged
 * does not arm it again.
 */
export function armTourRealVote(storage: TourStorage): void {
  if (readFlag(storage, WELCOME_TOUR_REAL_VOTE_LOGGED_KEY)) return;
  writeFlag(storage, WELCOME_TOUR_REAL_VOTE_PENDING_KEY);
}

/**
 * True the first time a real vote should log tour_first_real_vote.
 * Practice taps must not call this.
 */
export function consumeTourRealVote(storage: TourStorage): boolean {
  if (readFlag(storage, WELCOME_TOUR_REAL_VOTE_LOGGED_KEY)) return false;
  if (!readFlag(storage, WELCOME_TOUR_REAL_VOTE_PENDING_KEY)) return false;
  writeFlag(storage, WELCOME_TOUR_REAL_VOTE_LOGGED_KEY);
  clearFlag(storage, WELCOME_TOUR_REAL_VOTE_PENDING_KEY);
  return true;
}

export function stepsForTour(hasPracticeCard: boolean): readonly TourStepId[] {
  return hasPracticeCard ? TOUR_STEPS : QUICK_TOUR_STEPS;
}

export function seekTour(source: TourSource): TourPhase {
  return { status: "seeking", source };
}

export function startRunning(source: TourSource, hasPracticeCard: boolean): RunningTour {
  return {
    status: "running",
    source,
    steps: stepsForTour(hasPracticeCard),
    index: 0,
    side: null,
    split: null,
  };
}

export function currentTourStep(phase: TourPhase): TourStepId | null {
  if (phase.status !== "running") return null;
  return phase.steps[phase.index] ?? null;
}

export function advanceTour(phase: RunningTour): RunningTour | { status: "done" } {
  const next = phase.index + 1;
  if (next >= phase.steps.length) return { status: "done" };
  return { ...phase, index: next };
}

export function tourNextLabel(step: TourStepId): "Next" | "Done" | null {
  if (step === "practice_tap") return null;
  if (step === "ready") return "Done";
  return "Next";
}

/** The closing line has no target. Fixed bottom-nav items are skipped in the caller. */
export function tourTargetScrolls(step: TourStepId): boolean {
  return step !== "ready";
}

export function stepSpotlights(step: TourStepId): boolean {
  return step !== "ready";
}

/**
 * True when less than half of the target (capped at a short band) sits in
 * the comfortable viewport. A sticky chip row already under the header does
 * not need a scroll.
 */
export function targetNeedsScroll(
  rect: { top: number; bottom: number; height: number },
  viewportHeight: number,
  topInset: number,
  bottomInset = 0,
): boolean {
  const visibleTop = topInset + 8;
  const visibleBottom = viewportHeight - bottomInset - 8;
  const overlap = Math.min(rect.bottom, visibleBottom) - Math.max(rect.top, visibleTop);
  return overlap < Math.min(Math.max(rect.height, 1), 56) * 0.5;
}

/**
 * Live feed percents only. Missing or non-finite values stay missing
 * so the reveal copy does not invent a split.
 */
export function readPracticeSplit(
  rawA: string | null | undefined,
  rawB: string | null | undefined,
): PracticeSplit | null {
  if (rawA == null || rawB == null) return null;
  const aText = rawA.trim();
  const bText = rawB.trim();
  if (!aText || !bText) return null;
  const a = Number(aText);
  const b = Number(bText);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { a, b };
}

/** Dataset attributes for a VersusCard. Omitted when either percent is missing. */
export function practicePercentDataset(
  a: number | null | undefined,
  b: number | null | undefined,
): { "data-option-a-percent": string; "data-option-b-percent": string } | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return {
    "data-option-a-percent": String(a),
    "data-option-b-percent": String(b),
  };
}

/** The feed's number, unchanged. Whole values stay whole; nothing is rounded in. */
export function formatLivePercent(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

/**
 * Two feed percents as whole numbers that add to 100. Largest-remainder
 * rounding of their share of the pair. Missing or non-finite inputs stay null.
 */
export function roundSplitTo100(a: number, b: number): { a: number; b: number } | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const sum = a + b;
  if (sum <= 0) return { a: 0, b: 0 };
  const exact = [(a / sum) * 100, (b / sum) * 100];
  const floors = exact.map((value) => Math.floor(value));
  let left = 100 - (floors[0] + floors[1]);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((leftSide, rightSide) => rightSide.frac - leftSide.frac || leftSide.index - rightSide.index);
  for (const item of order) {
    if (left <= 0) break;
    floors[item.index] += 1;
    left -= 1;
  }
  return { a: floors[0], b: floors[1] };
}

export function practiceRevealCopy(split: PracticeSplit | null): string {
  const rounded = split ? roundSplitTo100(split.a, split.b) : null;
  if (!rounded) {
    return "That's the live split on this card. This practice tap was not saved.";
  }
  return `That's the live split: ${rounded.a}% and ${rounded.b}%. This practice tap was not saved.`;
}

export interface TourStepCopy {
  title: string;
  body: string;
}

export function tourStepCopy(step: TourStepId, split: PracticeSplit | null): TourStepCopy {
  switch (step) {
    case "practice_tap":
      return {
        title: "Tap who you think wins",
        body: "This is practice. Nothing is saved.",
      };
    case "practice_reveal":
      return { title: "Practice", body: practiceRevealCopy(split) };
    case "your_turn":
      return {
        title: "Now it's your turn",
        body: "Vote on any card when you want. That practice tap stayed on this screen.",
      };
    case "categories":
      return {
        title: "Category chips",
        body: "Filter the feed. This band stays with you as you scroll.",
      };
    case "predict":
      return { title: "Predict", body: "Call what happens next." };
    case "rankings":
      return { title: "Rankings", body: "See who is leading the influence index." };
    case "ready":
      return { title: "You're set", body: "Vote on a card whenever you like." };
  }
}

export function tourAnnouncement(step: TourStepId, split: PracticeSplit | null): string {
  const copy = tourStepCopy(step, split);
  return `${copy.title}. ${copy.body}`;
}

export function shouldSkipPractice(input: {
  cardFound: boolean;
  waitedMs: number;
  feedEmpty: boolean;
  waitMs?: number;
}): boolean {
  if (input.cardFound) return false;
  if (input.feedEmpty) return true;
  const wait = input.waitMs ?? PRACTICE_CARD_WAIT_MS;
  return input.waitedMs >= wait;
}

export function pickVisibleId(ids: readonly string[], isVisible: (id: string) => boolean): string | null {
  for (const id of ids) {
    if (isVisible(id)) return id;
  }
  return null;
}

/** Replay from another page opens the vote hub. `/` and `/vote` are already there. */
export function tourReplayDestination(pathname: string): "/vote" | null {
  if (pathname === "/" || pathname === "/vote") return null;
  return "/vote";
}

export function readSafeAreaInsets(style: { getPropertyValue(name: string): string }): SafeAreaInsets {
  const read = (name: string) => {
    const raw = style.getPropertyValue(name).trim();
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    top: read("--safe-area-inset-top"),
    right: read("--safe-area-inset-right"),
    bottom: read("--safe-area-inset-bottom"),
    left: read("--safe-area-inset-left"),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Place the bubble in the viewport, clear of safe-area insets.
 * A missing target centers it. Otherwise it sits above or below the target,
 * whichever has room, then clamps so it cannot slide under a notch or home bar.
 */
function overlapArea(
  bubble: { top: number; left: number; width: number; height: number },
  avoid: RectBox,
): number {
  const width = Math.min(bubble.left + bubble.width, avoid.left + avoid.width) - Math.max(bubble.left, avoid.left);
  const height = Math.min(bubble.top + bubble.height, avoid.top + avoid.height) - Math.max(bubble.top, avoid.top);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

export function placeBubble(args: {
  target: RectBox | null;
  viewportWidth: number;
  viewportHeight: number;
  bubbleWidth: number;
  bubbleHeight: number;
  insets: SafeAreaInsets;
  gap?: number;
  /** Keep the bubble off this rectangle when another side has more room. */
  avoid?: RectBox | null;
}): BubblePlacement {
  const gap = args.gap ?? 12;
  const minLeft = args.insets.left + 8;
  const minTop = args.insets.top + 8;
  const width = Math.max(
    160,
    Math.min(args.bubbleWidth, args.viewportWidth - args.insets.left - args.insets.right - 16),
  );
  const maxLeft = Math.max(minLeft, args.viewportWidth - args.insets.right - 8 - width);
  const maxTop = Math.max(minTop, args.viewportHeight - args.insets.bottom - 8 - args.bubbleHeight);

  if (!args.target) {
    return {
      top: clamp((args.viewportHeight - args.bubbleHeight) / 2, minTop, maxTop),
      left: clamp((args.viewportWidth - width) / 2, minLeft, maxLeft),
      width,
      side: "bottom",
    };
  }

  const left = clamp(args.target.left + args.target.width / 2 - width / 2, minLeft, maxLeft);
  const belowTop = args.target.top + args.target.height + gap;
  const aboveTop = args.target.top - gap - args.bubbleHeight;
  const roomBelow = args.viewportHeight - args.insets.bottom - 8 - belowTop;
  const roomAbove = args.target.top - gap - (args.insets.top + 8);
  let side: "top" | "bottom" =
    roomBelow >= args.bubbleHeight || roomBelow >= roomAbove ? "bottom" : "top";
  let top = clamp(side === "bottom" ? belowTop : aboveTop, minTop, maxTop);
  if (args.avoid) {
    const chosen = { top, left, width, height: args.bubbleHeight };
    const otherSide: "top" | "bottom" = side === "bottom" ? "top" : "bottom";
    const otherTop = clamp(otherSide === "bottom" ? belowTop : aboveTop, minTop, maxTop);
    const other = { top: otherTop, left, width, height: args.bubbleHeight };
    if (overlapArea(other, args.avoid) < overlapArea(chosen, args.avoid)) {
      side = otherSide;
      top = otherTop;
    }
  }
  return { top, left, width, side };
}

export function rectNeedsScroll(
  rect: { top: number; bottom: number },
  viewportHeight: number,
  topInset: number,
): boolean {
  return rect.top < topInset + 72 || rect.bottom > viewportHeight - 16;
}

/**
 * Block user scrolling without changing overflow or position. Setting
 * overflow:hidden pulls sticky headers and the chip band back to their
 * in-flow positions, which hides them when the page is scrolled.
 */
export function lockDocumentScroll(doc: Document): () => void {
  const blockPointer = (event: Event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-tour-allow-scroll]")) return;
    event.preventDefault();
  };
  const blockKeys = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return;
    const scrolls = event.key === " " || event.key === "PageUp" || event.key === "PageDown"
      || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End";
    if (!scrolls) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, textarea, [data-tour-allow-scroll]")) return;
    event.preventDefault();
  };
  doc.addEventListener("wheel", blockPointer, { passive: false });
  doc.addEventListener("touchmove", blockPointer, { passive: false });
  doc.addEventListener("keydown", blockKeys);

  return () => {
    doc.removeEventListener("wheel", blockPointer);
    doc.removeEventListener("touchmove", blockPointer);
    doc.removeEventListener("keydown", blockKeys);
  };
}

function browserSession(): TourStorage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function isWelcomeTourActive(): boolean {
  return tourActive;
}

export function setWelcomeTourActive(next: boolean): void {
  if (tourActive === next) return;
  tourActive = next;
  for (const listener of activeListeners) listener();
}

export function useWelcomeTourActive(): boolean {
  return useSyncExternalStore(subscribeWelcomeTourActive, isWelcomeTourActive, () => false);
}

export function subscribeWelcomeTourActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

export function subscribeTourRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}

/** Queue a tour. Same-tab listeners hear it; a later /vote mount reads session storage. */
export function requestWelcomeTour(source: TourSource): void {
  queuedSource = source;
  const session = browserSession();
  if (session) writeTourPending(session, source);
  for (const listener of requestListeners) listener();
}

export function takeTourRequest(): TourSource | null {
  const memory = queuedSource;
  queuedSource = null;
  const session = browserSession();
  const stored = session ? readTourPending(session) : null;
  if (session) clearTourPending(session);
  return memory ?? stored;
}

/** Test hook. Production code goes through request and take. */
export function resetWelcomeTourBus(): void {
  queuedSource = null;
  tourActive = false;
  activeListeners.clear();
  requestListeners.clear();
}
