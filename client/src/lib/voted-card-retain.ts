import type { HubActivityFilter } from "@/lib/hub-activity-filter";

/**
 * A card voted while "Not voted" / "Not predicted" is on.
 * It stays in place (`retained`) until the user moves on, then collapses
 * (`collapsing`) and leaves the list (`hidden`).
 */
export type VotedRetainPhase = "retained" | "collapsing" | "hidden";

export interface VotedRetainState {
  phases: Readonly<Record<string, VotedRetainPhase>>;
}

export const EMPTY_VOTED_RETAIN: VotedRetainState = { phases: {} };

/** How long a vertical-list collapse runs before the card leaves the list. */
export const VOTED_CARD_COLLAPSE_MS = 280;

export function retainVotedCard(state: VotedRetainState, key: string): VotedRetainState {
  if (!key || state.phases[key]) return state;
  return { phases: { ...state.phases, [key]: "retained" } };
}

/** Vote failed or was rolled back. The card is neither kept nor hidden. */
export function cancelVotedCard(state: VotedRetainState, key: string): VotedRetainState {
  if (!(key in state.phases)) return state;
  const phases = { ...state.phases };
  delete phases[key];
  return { phases };
}

/** The card has left the viewport. Start the collapse. */
export function collapseVotedCard(state: VotedRetainState, key: string): VotedRetainState {
  if (state.phases[key] !== "retained") return state;
  return { phases: { ...state.phases, [key]: "collapsing" } };
}

export function hideVotedCard(state: VotedRetainState, key: string): VotedRetainState {
  const phase = state.phases[key];
  if (phase !== "retained" && phase !== "collapsing") return state;
  return { phases: { ...state.phases, [key]: "hidden" } };
}

/**
 * Filter, category, or leaving the page.
 * `hide` drops every held card immediately (the list is being replaced).
 * `collapse` lets cards that are still retained play the collapse first.
 */
export function dropRetainedCards(
  state: VotedRetainState,
  mode: "collapse" | "hide",
): VotedRetainState {
  let changed = false;
  const phases = { ...state.phases };
  for (const key of Object.keys(phases)) {
    const phase = phases[key];
    if (phase === "hidden") continue;
    if (mode === "hide") {
      phases[key] = "hidden";
      changed = true;
      continue;
    }
    if (phase === "retained") {
      phases[key] = "collapsing";
      changed = true;
    }
  }
  return changed ? { phases } : state;
}

export function isVotedCardRetained(phase: VotedRetainPhase | null | undefined): boolean {
  return phase === "retained" || phase === "collapsing";
}

export function isVotedCardCollapsing(phase: VotedRetainPhase | null | undefined): boolean {
  return phase === "collapsing";
}

export function isVotedCardHidden(phase: VotedRetainPhase | null | undefined): boolean {
  return phase === "hidden";
}

/**
 * IntersectionObserver gate.
 * Release only after the card has actually been on screen and then left.
 * A card that mounts already off-screen (a display:none twin, a virtual
 * slide) has not been scrolled away yet.
 */
export function nextIntersectionWatch(input: {
  phase: VotedRetainPhase | null;
  wasVisible: boolean;
  isIntersecting: boolean;
}): { wasVisible: boolean; release: boolean } {
  if (input.phase !== "retained") {
    return { wasVisible: input.wasVisible, release: false };
  }
  if (input.isIntersecting) {
    return { wasVisible: true, release: false };
  }
  if (!input.wasVisible) {
    return { wasVisible: false, release: false };
  }
  return { wasVisible: true, release: true };
}

/**
 * Pixels to add to scrollTop (or scrollLeft) when `removed` pixels disappear.
 * A card entirely before the visible region would pull later content into
 * view; subtracting that size keeps what the user is looking at still.
 * A card entirely after the visible region does not move it.
 */
export function scrollDeltaForRemovedSize(input: {
  cardStart: number;
  cardEnd: number;
  viewportStart: number;
  viewportEnd: number;
  removed: number;
}): number {
  if (!(input.removed > 0)) return 0;
  if (input.cardEnd <= input.viewportStart) return -input.removed;
  if (input.cardStart >= input.viewportEnd) return 0;
  return 0;
}

/**
 * After one carousel slide is removed, the index that keeps the slide
 * the user is looking at. Removing a slide at or before the active one
 * shifts every later slide back by one.
 */
export function carouselIndexAfterRemoval(input: {
  removedIndex: number;
  activeIndex: number;
  nextLength: number;
}): number {
  if (input.nextLength <= 0) return 0;
  const shift = input.removedIndex <= input.activeIndex ? 1 : 0;
  return Math.max(0, Math.min(input.activeIndex - shift, input.nextLength - 1));
}

export interface LastVotedAnchor {
  key: string;
  visitId: string;
  /**
   * Set when the vote happens during this page visit while the "not yet"
   * filter is on. Cleared after one return attempt so a later filter
   * change does not steal the scroll position.
   */
  pendingReturn: boolean;
}

/**
 * Scroll back only for the switch to All or Votes/Positions only that
 * follows a vote in this same page visit, and only when that card is
 * still in the destination list.
 */
export function shouldReturnToVotedCard(input: {
  anchor: LastVotedAnchor | null;
  visitId: string;
  nextFilter: HubActivityFilter;
  previousFilter: HubActivityFilter;
  cardInList: boolean;
}): boolean {
  const anchor = input.anchor;
  if (!anchor?.pendingReturn) return false;
  if (!anchor.key || anchor.visitId !== input.visitId) return false;
  if (input.previousFilter === input.nextFilter) return false;
  if (input.nextFilter !== "all" && input.nextFilter !== "show-mine") return false;
  return input.cardInList;
}

/**
 * Space between the sticky chip band and the top of a card scrolled back
 * into view. One value for mobile and desktop — the sticky stack height
 * is measured per viewport, and this gap is added the same way on both.
 */
export const VOTED_CARD_RETURN_GAP_PX = 8;

/**
 * Document scrollY that puts the card's top just under the sticky stack
 * (site header plus the chip band) plus `VOTED_CARD_RETURN_GAP_PX`.
 * Short cards use that same offset; they are not centred in the viewport.
 */
export function scrollTopToCenterCard(input: {
  scrollY: number;
  cardTop: number;
  cardHeight: number;
  viewportHeight: number;
  stickyTopPx: number;
  bandHeightPx: number;
}): number {
  const stickyTop = Number.isFinite(input.stickyTopPx) ? Math.max(0, input.stickyTopPx) : 0;
  const band = Number.isFinite(input.bandHeightPx) ? Math.max(0, input.bandHeightPx) : 0;
  const targetTop = stickyTop + band + VOTED_CARD_RETURN_GAP_PX;
  const cardTop = Number.isFinite(input.cardTop) ? input.cardTop : 0;
  const scrollY = Number.isFinite(input.scrollY) ? input.scrollY : 0;
  return Math.max(0, Math.round(scrollY + cardTop - targetTop));
}

/** Mixed-feed window key for a vote retain key, when that card lives in the All feed. */
export function mixedFeedKeyForRetainKey(retainKey: string): string | null {
  const sep = retainKey.indexOf(":");
  if (sep <= 0) return null;
  const kind = retainKey.slice(0, sep);
  const id = retainKey.slice(sep + 1);
  if (!id) return null;
  if (kind === "matchups") return `matchup:${id}`;
  if (kind === "sentiment" || kind === "opinion" || kind === "rating") return `${kind}:${id}`;
  return null;
}

export function retainIdFromKey(retainKey: string): string {
  const sep = retainKey.indexOf(":");
  return sep < 0 ? retainKey : retainKey.slice(sep + 1);
}
