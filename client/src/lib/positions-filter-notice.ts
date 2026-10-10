import type { HubActivityFilter } from "./hub-activity-filter";

export type PredictPositionSection = "updown" | "h2h" | "gainer";

/**
 * One line above the cards after a positions filter is applied.
 * A zero count stays numberless so a still-loading list does not claim "0".
 */
export function positionsFilterStatusLine(
  filter: HubActivityFilter,
  visibleCount: number,
): string | null {
  if (filter === "all") return null;
  if (filter === "hide-mine") return "Hiding markets you've predicted on";
  if (visibleCount <= 0) return "Showing only your active positions";
  const noun = visibleCount === 1 ? "position" : "positions";
  return `Showing your ${visibleCount} active ${noun}`;
}

export function positionsFilterEmptyCopy(
  filter: HubActivityFilter,
): { title: string; detail: string } | null {
  if (filter === "show-mine") {
    return {
      title: "You don't have any active positions in this view",
      detail: "Try the other tab, or show every market again.",
    };
  }
  if (filter === "hide-mine") {
    return {
      title: "You've predicted on every market in this view",
      detail: "Show all to see the markets you've already predicted on.",
    };
  }
  return null;
}

/** Per-section empty line when a sibling section still has cards. */
export function positionsSectionEmptyMessage(
  filter: HubActivityFilter,
  section: PredictPositionSection,
): string | null {
  if (filter === "all") return null;
  if (filter === "show-mine") {
    if (section === "updown") return "No active Up/Down positions";
    if (section === "h2h") return "No active Head-to-Head positions";
    return "No active Category Race positions";
  }
  if (section === "updown") return "You've predicted on every Up/Down market";
  if (section === "h2h") return "You've predicted on every Head-to-Head market";
  return "You've predicted on every Category Race";
}
