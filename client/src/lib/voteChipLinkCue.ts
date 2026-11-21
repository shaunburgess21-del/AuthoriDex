import {
  VOTE_ALL_SECTION_LAYOUT_MIN_PX,
  VOTE_FEED_CUE_LABELS,
  VOTE_SECTION_CUE_LABELS,
  type VoteFeedKind,
} from "@/lib/voteMixedFeed";

/** How many times one chip may explain itself during a browser session. */
export const VOTE_CHIP_CUE_MAX_SHOWS = 2;

export const VOTE_CHIP_CUE_STORAGE_KEY = "voxdex.voteChipLinkCue";

/**
 * Widest the pill may paint at a 320px viewport without meeting the header
 * actions or the screen edge. Page padding, the header inset, and the
 * help / browse buttons account for the reserved space.
 */
export const VOTE_CHIP_CUE_NARROW_BUDGET_PX = 184;

const SECTION_KIND: Record<string, VoteFeedKind> = {
  "Sentiment Polls": "sentiment",
  Matchups: "matchup",
  "Opinion Polls": "opinion",
  "Overall Rating": "rating",
};

export interface VoteChipLinkCue {
  section: string;
  kind: VoteFeedKind;
  chipLabel: string;
  /** Chip label, then the section name. "Agree? = Sentiment Polls". */
  text: string;
}

export interface VoteChipCueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Link copy for a typed section, or null for All, Induction, and Curate. */
export function voteChipLinkCue(section: string): VoteChipLinkCue | null {
  const kind = SECTION_KIND[section];
  if (!kind) return null;
  const chipLabel = VOTE_SECTION_CUE_LABELS[section] ?? VOTE_FEED_CUE_LABELS[kind];
  return {
    section,
    kind,
    chipLabel,
    text: `${chipLabel} = ${section}`,
  };
}

/**
 * A chip tap on a narrow viewport is the only time the cue is offered.
 * Loading a section, restoring one, or using the desktop layout stays quiet.
 */
export function shouldOfferVoteChipLinkCue(args: {
  section: string;
  viewportWidth: number;
  fromChipTap: boolean;
}): boolean {
  if (!args.fromChipTap) return false;
  if (args.viewportWidth >= VOTE_ALL_SECTION_LAYOUT_MIN_PX) return false;
  return voteChipLinkCue(args.section) !== null;
}

function readCounts(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(n) && n > 0) counts[key] = Math.floor(n);
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Record one show and return the cue, or null when this chip is out of
 * shows (or storage cannot remember the count). Does not write for sections
 * that have no cue.
 */
export function claimVoteChipLinkCue(
  section: string,
  store: VoteChipCueStore,
): VoteChipLinkCue | null {
  const cue = voteChipLinkCue(section);
  if (!cue) return null;
  try {
    const counts = readCounts(store.getItem(VOTE_CHIP_CUE_STORAGE_KEY));
    const seen = counts[section] ?? 0;
    if (seen >= VOTE_CHIP_CUE_MAX_SHOWS) return null;
    counts[section] = seen + 1;
    store.setItem(VOTE_CHIP_CUE_STORAGE_KEY, JSON.stringify(counts));
    return cue;
  } catch {
    return null;
  }
}

/**
 * Conservative width of the pill label at 11px. 0.56em is wider than the
 * average VoxGlyph/Inter glyph for this copy, so a pass still fits.
 */
export function voteChipLinkCueLabelWidthPx(text: string): number {
  return Math.ceil(text.length * 11 * 0.56);
}

/** Icon, gap, and horizontal padding around the label. */
export const VOTE_CHIP_CUE_CHROME_PX = 28;

export function voteChipLinkCueFitsNarrowViewport(text: string, viewport = 320): boolean {
  const budget = VOTE_CHIP_CUE_NARROW_BUDGET_PX + (viewport - 320);
  return voteChipLinkCueLabelWidthPx(text) + VOTE_CHIP_CUE_CHROME_PX <= budget;
}
