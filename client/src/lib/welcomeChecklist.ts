/**
 * New-visitor checklist on /vote (item 49).
 *
 * The card sits in normal page flow where the returning-user strip sits.
 * Visibility is pure so the slot can be decided without a browser and so a
 * signed-out dismiss stays dismissed after sign-in. Ticks are never invented:
 * callers pass null until GET /api/me/votes, GET /api/me/predictions, and
 * GET /api/me/favorites have actually answered.
 */

export const WELCOME_CHECKLIST_HEADLINE =
  "See what the world really thinks, and call what happens next.";

export const WELCOME_ALL_SET_LABEL = "You're all set";

export const WELCOME_HOW_IT_WORKS_LABEL = "How it works";

export const WELCOME_HOW_IT_WORKS_HREF = "/how-it-works";

export const WELCOME_PREDICT_HREF = "/predict";

/** Rankings, where the existing favorite star lives on a person's quick view. */
export const WELCOME_FAVORITE_HREF = "/rankings";

export const WELCOME_STEP_COUNT = 3;

/** How long the done line stays before the card leaves. */
export const WELCOME_ALL_SET_MS = 2200;

/** Signed-out dismiss. Honored after sign-in on this device. */
export const WELCOME_DEVICE_DISMISS_KEY = "voxdex_welcome_checklist_dismissed";

export const WELCOME_UNVOTED_ATTR = "data-welcome-unvoted";

export interface WelcomeStepCopy {
  id: "vote" | "predict" | "favorite";
  label: string;
}

export const WELCOME_STEPS: readonly WelcomeStepCopy[] = [
  { id: "vote", label: "Vote on a card" },
  { id: "predict", label: "Make a prediction" },
  { id: "favorite", label: "Favorite someone" },
];

export function welcomeUserDismissKey(userId: string): string {
  return `voxdex_welcome_checklist_dismissed:${userId}`;
}

export function welcomeCompleteKey(userId: string): string {
  return `voxdex_welcome_checklist_complete:${userId}`;
}

/** Remembered so the next visit can reserve the card before profile data arrives. */
export function welcomeOpenKey(userId: string): string {
  return `voxdex_welcome_checklist_open:${userId}`;
}

export interface WelcomeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function readFlag(storage: Pick<WelcomeStorage, "getItem">, key: string): boolean {
  try {
    return storage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(storage: Pick<WelcomeStorage, "setItem">, key: string): void {
  try {
    storage.setItem(key, "1");
  } catch {
    /* private mode / quota */
  }
}

function clearFlag(storage: Pick<WelcomeStorage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* private mode */
  }
}

export function readWelcomeDeviceDismissed(storage: Pick<WelcomeStorage, "getItem">): boolean {
  return readFlag(storage, WELCOME_DEVICE_DISMISS_KEY);
}

export function readWelcomeUserDismissed(
  storage: Pick<WelcomeStorage, "getItem">,
  userId: string,
): boolean {
  return readFlag(storage, welcomeUserDismissKey(userId));
}

export function readWelcomeComplete(storage: Pick<WelcomeStorage, "getItem">, userId: string): boolean {
  return readFlag(storage, welcomeCompleteKey(userId));
}

export function readWelcomeOpen(storage: Pick<WelcomeStorage, "getItem">, userId: string): boolean {
  return readFlag(storage, welcomeOpenKey(userId));
}

export function writeWelcomeDeviceDismissed(storage: Pick<WelcomeStorage, "setItem">): void {
  writeFlag(storage, WELCOME_DEVICE_DISMISS_KEY);
}

export function writeWelcomeUserDismissed(storage: Pick<WelcomeStorage, "setItem">, userId: string): void {
  writeFlag(storage, welcomeUserDismissKey(userId));
}

export function writeWelcomeComplete(
  storage: Pick<WelcomeStorage, "setItem" | "removeItem">,
  userId: string,
): void {
  writeFlag(storage, welcomeCompleteKey(userId));
  clearFlag(storage, welcomeOpenKey(userId));
}

export function writeWelcomeOpen(storage: Pick<WelcomeStorage, "setItem">, userId: string): void {
  writeFlag(storage, welcomeOpenKey(userId));
}

export function clearWelcomeOpen(storage: Pick<WelcomeStorage, "removeItem">, userId: string): void {
  clearFlag(storage, welcomeOpenKey(userId));
}

export type WelcomePhase = "hidden" | "checklist" | "all-set";

export interface WelcomePhaseInput {
  /** False while we cannot yet tell signed-in from signed-out. */
  audienceKnown: boolean;
  signedIn: boolean;
  deviceDismissed: boolean;
  userDismissed: boolean;
  persistedComplete: boolean;
  /** A previous visit showed the card while a step was still open. */
  persistedOpen: boolean;
  /** Profile already says this person has not voted or has not predicted. */
  profileProvesPartial: boolean;
  /** Null until that endpoint has answered. Never treat null as done. */
  hasVote: boolean | null;
  hasPrediction: boolean | null;
  hasFavorite: boolean | null;
  /** This mount has seen a settled step that is still false. */
  sawIncomplete: boolean;
}

/**
 * Signed-out visitors see the card unless this device dismissed it.
 * Signed-in visitors see it until every step is confirmed done, or until
 * they dismiss it. Someone who already has a vote, a prediction, and a
 * favorite never sees it (item 43), including the "You're all set" line.
 * Completing the last step while the card is open returns "all-set".
 */
export function welcomeChecklistPhase(input: WelcomePhaseInput): WelcomePhase {
  if (!input.audienceKnown) return "hidden";
  if (input.deviceDismissed) return "hidden";
  if (input.signedIn && (input.userDismissed || input.persistedComplete)) return "hidden";
  if (!input.signedIn) return "checklist";

  const known =
    input.hasVote != null && input.hasPrediction != null && input.hasFavorite != null;
  const allDone =
    known && input.hasVote === true && input.hasPrediction === true && input.hasFavorite === true;

  if (allDone && !input.sawIncomplete) return "hidden";
  if (allDone && input.sawIncomplete) return "all-set";

  const partial =
    input.profileProvesPartial ||
    input.persistedOpen ||
    input.hasVote === false ||
    input.hasPrediction === false ||
    input.hasFavorite === false ||
    (known && !allDone);

  return partial ? "checklist" : "hidden";
}

/**
 * The daily-goal strip and its invite card stay down while the checklist
 * owns the slot, including the brief done line.
 */
export function returningStripAllowed(stripEligible: boolean, phase: WelcomePhase): boolean {
  if (phase === "checklist" || phase === "all-set") return false;
  return stripEligible;
}

export function welcomeDoneCount(flags: {
  hasVote: boolean | null;
  hasPrediction: boolean | null;
  hasFavorite: boolean | null;
}): number {
  return [flags.hasVote, flags.hasPrediction, flags.hasFavorite].filter((value) => value === true).length;
}

export function welcomeProgressLabel(done: number): string {
  const safe = Number.isFinite(done) ? Math.max(0, Math.min(WELCOME_STEP_COUNT, Math.floor(done))) : 0;
  return `${safe} of ${WELCOME_STEP_COUNT}`;
}

/** True when the profile counters already rule out "has all three". */
export function profileProvesPartial(profile: {
  totalVotes?: number | null;
  totalPredictions?: number | null;
} | null | undefined): boolean {
  if (!profile) return false;
  const votes = profile.totalVotes;
  const predictions = profile.totalPredictions;
  return votes === 0 || predictions === 0;
}

/**
 * GET /api/me/votes is a JSON array. A non-array is unknown, not a tick
 * and not proof the list is empty.
 */
export function voteListHasBallot(data: unknown): boolean | null {
  if (!Array.isArray(data)) return null;
  return data.some((row) => row != null && typeof row === "object");
}

/** GET /api/me/predictions is `{ predictions }` or a legacy bare array. */
export function predictionListHasRow(data: unknown): boolean | null {
  if (Array.isArray(data)) return data.length > 0;
  if (!data || typeof data !== "object" || !("predictions" in data)) return null;
  const list = (data as { predictions: unknown }).predictions;
  if (!Array.isArray(list)) return null;
  return list.length > 0;
}

/** GET /api/me/favorites is a JSON array (or `{ favorites }` if that shape appears). */
export function favoriteListHasPerson(data: unknown): boolean | null {
  if (Array.isArray(data)) return data.some((row) => row != null && typeof row === "object");
  if (!data || typeof data !== "object" || !("favorites" in data)) return null;
  const list = (data as { favorites: unknown }).favorites;
  if (!Array.isArray(list)) return null;
  return list.some((row) => row != null && typeof row === "object");
}

export function firstUnvotedFeedKey(
  entries: readonly { key: string; voted: boolean }[],
): string | null {
  const found = entries.find((entry) => entry.voted === false);
  return found ? found.key : null;
}

export function pickFirstVisibleUnvoted<T extends { unvoted: boolean; visible: boolean }>(
  nodes: readonly T[],
): T | null {
  return nodes.find((node) => node.unvoted && node.visible) ?? null;
}

/** First unvoted card that is actually on screen. Hidden responsive copies are skipped. */
export function firstVisibleUnvotedCard(root: ParentNode): HTMLElement | null {
  const nodes = root.querySelectorAll<HTMLElement>(`[${WELCOME_UNVOTED_ATTR}="true"]`);
  for (const node of nodes) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

export function scrollTargetIntoView(element: HTMLElement, reduceMotion: boolean): void {
  element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}
