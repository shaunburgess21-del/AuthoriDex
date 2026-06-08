/** Live mover line — recomputed on each overview load from 24h climbers. */
export function formatBriefingMoverHeadline(name: string): string {
  return `${name} leads today's biggest movers`;
}

/** Cached anchor line — tied to briefing prose (twice-daily refresh). */
export function formatBriefingAnchorHeadline(name: string): string {
  return `${name} leads today's news coverage`;
}

export interface BriefingHeadlinePerson {
  id: string;
  name: string;
}

/** Build the 1–2 display lines for the Today tab briefing header. */
export function buildBriefingDisplayHeadlines(params: {
  liveMover?: BriefingHeadlinePerson | null;
  leadAnchor?: BriefingHeadlinePerson | null;
  /** Used when no live climber is available (e.g. thin movers board). */
  fallbackHeadline?: string;
}): string[] {
  const { liveMover, leadAnchor, fallbackHeadline } = params;
  const samePerson =
    liveMover && leadAnchor && liveMover.id === leadAnchor.id;

  const lines: string[] = [];

  if (liveMover) {
    lines.push(formatBriefingMoverHeadline(liveMover.name));
  } else if (fallbackHeadline) {
    lines.push(fallbackHeadline);
  }

  if (leadAnchor && !samePerson) {
    lines.push(formatBriefingAnchorHeadline(leadAnchor.name));
  }

  return lines;
}

export function pickLeadAnchor(
  anchors: Array<{ id: string; name: string }>,
): BriefingHeadlinePerson | undefined {
  const lead = anchors[0];
  if (!lead) return undefined;
  return { id: lead.id, name: lead.name };
}
