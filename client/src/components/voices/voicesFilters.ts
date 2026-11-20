import {
  CANONICAL_CATEGORIES,
  VOICES_SURFACES,
  getMarketCategoryLabel,
  type VoicesSurface,
} from "../../../../shared/constants";
import type { VoicesFeedMode, VoicesFilters } from "./types";

/**
 * User-facing post-type toggles. Internal feed params stay the existing
 * surface keys — "Polls" is the only toggle that maps onto two of them.
 * Labels match the /vote cue words (Head-to-head, Polls).
 */
export interface VoicesPostTypeToggle {
  id: string;
  label: string;
  surfaces: readonly VoicesSurface[];
  testId: string;
}

export const VOICES_POST_TYPE_TOGGLES: readonly VoicesPostTypeToggle[] = [
  {
    id: "polls",
    label: "Polls",
    // Sentiment + opinion only. world_market is the Predictions toggle.
    surfaces: ["sentiment_poll", "opinion_poll"],
    testId: "voices-post-type-polls",
  },
  {
    id: "matchup",
    label: "Head-to-head",
    surfaces: ["matchup"],
    testId: "voices-post-type-matchup",
  },
  {
    id: "timeline",
    label: "General posts",
    surfaces: ["timeline"],
    testId: "voices-post-type-timeline",
  },
  {
    id: "world_market",
    label: "Predictions",
    surfaces: ["world_market"],
    testId: "voices-post-type-world_market",
  },
  {
    id: "profile",
    label: "Profiles",
    surfaces: ["profile"],
    testId: "voices-post-type-profile",
  },
];

const VOICES_MODES = new Set<VoicesFeedMode>(["for-you", "latest", "top"]);
const OWNED_QUERY_KEYS = new Set(["mode", "surfaces", "categories", "personIds"]);

/** Favourites are sent as personIds. The favorites API already caps at 50. */
export const VOICES_FAVOURITES_PERSON_CAP = 50;

export const VOICES_EMPTY_DEFAULT_TITLE = "No voices yet";
export const VOICES_EMPTY_DEFAULT_BODY =
  "Be the first to share a take with the Town Square.";

export interface VoicesEmptyCopy {
  filtered: boolean;
  title: string;
  body: string | null;
}

/**
 * A toggle is on when any of its surfaces are selected, so a partial URL
 * (just sentiment_poll) still shows the Polls chip and counts as one.
 * Toggles do not share surfaces: world_market never turns Polls on.
 */
export function postTypeIsOn(
  surfaces: readonly string[],
  toggleSurfaces: readonly string[],
): boolean {
  return toggleSurfaces.some((surface) => surfaces.includes(surface));
}

export function postTypeToggleById(id: string): VoicesPostTypeToggle | undefined {
  return VOICES_POST_TYPE_TOGGLES.find((toggle) => toggle.id === id);
}

export function withoutPostType(
  surfaces: readonly VoicesSurface[],
  toggleSurfaces: readonly VoicesSurface[],
): VoicesSurface[] {
  const drop = new Set<string>(toggleSurfaces);
  return surfaces.filter((surface) => !drop.has(surface));
}

/** On adds every surface in the toggle. Off removes every surface in it. */
export function togglePostType(
  surfaces: readonly VoicesSurface[],
  toggleSurfaces: readonly VoicesSurface[],
): VoicesSurface[] {
  if (postTypeIsOn(surfaces, toggleSurfaces)) {
    return withoutPostType(surfaces, toggleSurfaces);
  }
  const next = [...surfaces];
  for (const surface of toggleSurfaces) {
    if (!next.includes(surface)) next.push(surface);
  }
  return next;
}

export function activePostTypeToggles(surfaces: readonly string[]): VoicesPostTypeToggle[] {
  return VOICES_POST_TYPE_TOGGLES.filter((toggle) => postTypeIsOn(surfaces, toggle.surfaces));
}

export function countActiveVoiceFilters(
  filters: VoicesFilters,
  options?: { personCount?: number },
): number {
  const people = options?.personCount ?? filters.personIds.length;
  return activePostTypeToggles(filters.surfaces).length + filters.categories.length + people;
}

export function voicesFilterButtonLabel(count: number): string {
  if (count <= 0) return "Filter";
  return `Filter (${count})`;
}

export function favouritePersonIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= VOICES_FAVOURITES_PERSON_CAP) break;
  }
  return out;
}

export function favouritesSelectionActive(
  personIds: readonly string[],
  favouriteIds: readonly string[],
): boolean {
  const capped = favouritePersonIds(favouriteIds);
  if (capped.length === 0) return false;
  const selected = new Set(personIds);
  return capped.every((id) => selected.has(id));
}

export function applyFavourites(favouriteIds: readonly string[]): string[] {
  return favouritePersonIds(favouriteIds);
}

export function clearFavourites(
  personIds: readonly string[],
  favouriteIds: readonly string[],
): string[] {
  const drop = new Set(favouritePersonIds(favouriteIds));
  return personIds.filter((id) => !drop.has(id));
}

/** My favourites counts as one slot, plus any celebrities added on top. */
export function voiceFilterPersonSlots(
  personIds: readonly string[],
  favouriteIds: readonly string[],
): number {
  if (!favouritesSelectionActive(personIds, favouriteIds)) return personIds.length;
  const fav = new Set(favouritePersonIds(favouriteIds));
  const extras = personIds.filter((id) => !fav.has(id)).length;
  return 1 + extras;
}

export function shouldShowFavouritesChip(isSignedIn: boolean, favouriteCount: number): boolean {
  return isSignedIn && favouriteCount > 0;
}

/**
 * Registry label when the admin list has one, otherwise the canonical
 * display label. Never the stored slug.
 */
export function categoryFilterLabel(
  id: string,
  registryLabels?: ReadonlyMap<string, string>,
): string {
  const fromRegistry = registryLabels?.get(id)?.trim();
  if (fromRegistry) return fromRegistry;
  const canonical = CANONICAL_CATEGORIES.find((category) => category.id === id)?.label;
  if (canonical) return canonical;
  return getMarketCategoryLabel(id);
}

function joinOr(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function displayPersonLabels(labels: readonly string[]): string[] {
  const named = labels.map((label) => label.trim()).filter((label) => label && label !== "Celebrity");
  const unknown = labels.length - named.length;
  if (unknown === 1) named.push("a selected celebrity");
  else if (unknown > 1) named.push("selected celebrities");
  return named;
}

export function voicesEmptyFilterSentence(args: {
  postTypeLabels: readonly string[];
  personLabels: readonly string[];
  categoryLabels: readonly string[];
  favourites?: boolean;
}): string | null {
  const people = args.favourites ? ["your favourites", ...args.personLabels] : [...args.personLabels];
  const categories = args.categoryLabels.filter(Boolean);
  const types = args.postTypeLabels.filter(Boolean);
  const namedPeople = people.filter(Boolean);
  if (types.length + namedPeople.length + categories.length === 0) return null;

  const kind = types.length > 0 ? `${joinOr(types)} posts` : "posts";
  let about = "";
  if (namedPeople.length > 0 && categories.length > 0) {
    about = ` about ${joinOr(namedPeople)} in ${joinOr(categories)}`;
  } else if (namedPeople.length > 0) {
    about = ` about ${joinOr(namedPeople)}`;
  } else if (categories.length > 0) {
    about = ` about ${joinOr(categories)}`;
  }
  return `No ${kind}${about} yet`;
}

export function describeVoicesEmptyState(args: {
  filters: VoicesFilters;
  categoryLabel: (id: string) => string;
  personLabel: (id: string) => string;
  favouritesActive?: boolean;
  favouriteIds?: readonly string[];
}): VoicesEmptyCopy {
  const hidden = new Set(
    args.favouritesActive ? favouritePersonIds(args.favouriteIds ?? args.filters.personIds) : [],
  );
  const sentence = voicesEmptyFilterSentence({
    postTypeLabels: activePostTypeToggles(args.filters.surfaces).map((toggle) => toggle.label),
    personLabels: displayPersonLabels(
      args.filters.personIds.filter((id) => !hidden.has(id)).map((id) => args.personLabel(id)),
    ),
    categoryLabels: args.filters.categories.map((id) => args.categoryLabel(id)),
    favourites: Boolean(args.favouritesActive),
  });
  if (!sentence) {
    return {
      filtered: false,
      title: VOICES_EMPTY_DEFAULT_TITLE,
      body: VOICES_EMPTY_DEFAULT_BODY,
    };
  }
  return { filtered: true, title: sentence, body: null };
}

function splitList(value: string | null): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function parseVoicesQuery(search: string): { mode: VoicesFeedMode; filters: VoicesFilters } {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const modeRaw = params.get("mode");
  const mode: VoicesFeedMode =
    modeRaw && VOICES_MODES.has(modeRaw as VoicesFeedMode) ? (modeRaw as VoicesFeedMode) : "for-you";
  const allowed = new Set<string>(VOICES_SURFACES);
  const surfaces = splitList(params.get("surfaces")).filter((surface): surface is VoicesSurface =>
    allowed.has(surface),
  );
  return {
    mode,
    filters: {
      surfaces,
      categories: splitList(params.get("categories")),
      personIds: splitList(params.get("personIds")),
    },
  };
}

function encodeList(values: readonly string[]): string {
  return values.map((value) => encodeURIComponent(value)).join(",");
}

/**
 * Mirror mode, surfaces, categories and personIds onto the page query.
 * Default mode is omitted. `post` and any other params are preserved.
 */
export function writeVoicesQuery(
  currentSearch: string,
  state: { mode: VoicesFeedMode; filters: VoicesFilters },
): string {
  const raw = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  const current = new URLSearchParams(raw);
  const preserved: Array<[string, string]> = [];
  for (const [key, value] of current) {
    if (OWNED_QUERY_KEYS.has(key)) continue;
    preserved.push([key, value]);
  }

  const parts: string[] = [];
  if (state.mode !== "for-you") parts.push(`mode=${encodeURIComponent(state.mode)}`);
  if (state.filters.surfaces.length > 0) parts.push(`surfaces=${encodeList(state.filters.surfaces)}`);
  if (state.filters.categories.length > 0) parts.push(`categories=${encodeList(state.filters.categories)}`);
  if (state.filters.personIds.length > 0) parts.push(`personIds=${encodeList(state.filters.personIds)}`);
  for (const [key, value] of preserved) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** Feed request query. Same surface keys as the page URL, plus paging. */
export function voicesFeedSearchParams(
  mode: VoicesFeedMode,
  filters: VoicesFilters,
  cursor: string | null = null,
): string {
  const params = new URLSearchParams();
  params.set("mode", mode);
  params.set("limit", "20");
  if (filters.surfaces.length > 0) params.set("surfaces", filters.surfaces.join(","));
  if (filters.personIds.length > 0) params.set("personIds", filters.personIds.join(","));
  if (filters.categories.length > 0) params.set("categories", filters.categories.join(","));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export type VoicesHistoryAction = "push" | "replace" | "none";

/**
 * One history entry per committed filter state.
 * The first sync replaces, so a non-canonical URL does not add an entry.
 * While the mobile panel is open, edits stay out of the stack (a celebrity
 * search keystroke must not become its own entry). Closing the panel or
 * Show results commits once. Desktop changes are committed immediately.
 */
export function nextVoicesHistoryAction(args: {
  currentSearch: string;
  mode: VoicesFeedMode;
  filters: VoicesFilters;
  canonicalize: boolean;
  defer: boolean;
}): { action: VoicesHistoryAction; search: string } {
  const search = writeVoicesQuery(args.currentSearch, {
    mode: args.mode,
    filters: args.filters,
  });
  if (args.defer) return { action: "none", search };
  if (search === args.currentSearch) return { action: "none", search };
  if (args.canonicalize) return { action: "replace", search };
  return { action: "push", search };
}

/**
 * Empty-state Clear filters sits under the composer. Focusing the composer
 * ("Post the first take") opens an action row; blurring it collapses that
 * row and slides the button out from under the pointer, so the click never
 * lands. Commit on pointerdown and cancel the focus change. A later click
 * (or a keyboard click that never saw a pointer) clears too — setting the
 * same empty filters twice is a no-op.
 */
export function emptyStateClearGesture(event: {
  type: "pointerdown" | "click";
  button?: number;
}): { clear: boolean; preventFocusChange: boolean } {
  if (event.type === "click") return { clear: true, preventFocusChange: false };
  if ((event.button ?? 0) !== 0) return { clear: false, preventFocusChange: false };
  return { clear: true, preventFocusChange: true };
}

/**
 * Lift a bottom sheet above the software keyboard. iOS Safari and WKWebView
 * keep `position: fixed; bottom: 0` on the layout viewport, so the keyboard
 * covers it unless we subtract the visual-viewport overlap. No transform —
 * a transformed sheet makes that same keyboard pan the input off screen.
 */
export function voicesSheetKeyboardOffset(metrics: {
  innerHeight: number;
  viewportHeight: number;
  viewportOffsetTop: number;
}): { bottom: number; maxHeight: number } {
  const inner = Math.max(0, metrics.innerHeight);
  const height = Math.max(0, metrics.viewportHeight);
  const offsetTop = Math.max(0, metrics.viewportOffsetTop);
  const visibleBottom = offsetTop + height;
  const bottom = Math.max(0, Math.round(inner - visibleBottom));
  const maxHeight = Math.max(240, Math.round(Math.min(height, inner) - 16));
  return { bottom, maxHeight };
}
