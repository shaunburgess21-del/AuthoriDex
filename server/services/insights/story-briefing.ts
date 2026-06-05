export const BRIEFING_TOP_GAINERS = 3;

const STORY_REFRESH_UTC_HOURS = [6, 18] as const;

export interface BriefingPersonInput {
  id: string;
  name: string;
  rank: number;
  change24h: number;
  category: string;
  whyTrending?: string;
  topHeadline?: string;
}

export interface BriefingInputs {
  topGainers: BriefingPersonInput[];
  notableDropper: BriefingPersonInput | null;
  people: Array<{ id: string; name: string }>;
}

/**
 * The briefing prose is regenerated only twice daily, but the 24h leaderboard
 * churns hourly — so the copy must stay valid for ~12h. We keep it
 * number-light (no exact "+9.4%" that goes stale within an hour); the live
 * headline + mover strip on the client carry the current figures.
 */

/** Next 06:00 or 18:00 UTC refresh boundary (whichever is sooner). */
export function nextBriefingRefreshIso(from: Date = new Date()): string {
  const now = from;
  const candidates = STORY_REFRESH_UTC_HOURS.map((hour) => {
    const next = new Date(now);
    next.setUTCHours(hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    return next;
  });
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0]!.toISOString();
}

export function buildDeterministicHeadline(inputs: BriefingInputs): string {
  const lead = inputs.topGainers[0];
  return lead ? `${lead.name} leads today's movers` : "Today's influence snapshot";
}

function beatForGainer(gainer: BriefingPersonInput): string {
  if (gainer.whyTrending) return gainer.whyTrending;
  return `${gainer.name} is climbing the leaderboard in ${gainer.category}.`;
}

export function buildDeterministicParagraphs(inputs: BriefingInputs): string[] {
  const paragraphs: string[] = [];

  if (inputs.topGainers.length > 0) {
    const lead = inputs.topGainers[0]!;
    // Number-light lead so it doesn't contradict the live figures shown
    // alongside it once the leaderboard shifts.
    if (lead.whyTrending) {
      paragraphs.push(lead.whyTrending);
    } else {
      paragraphs.push(`${lead.name} is among the names gaining attention today.`);
    }

    for (const gainer of inputs.topGainers.slice(1)) {
      paragraphs.push(beatForGainer(gainer));
    }
  } else {
    paragraphs.push("The board is steady today with no standout 24-hour movers.");
  }

  if (inputs.notableDropper) {
    const d = inputs.notableDropper;
    if (d.whyTrending) {
      paragraphs.push(`Meanwhile, ${d.whyTrending}`);
    } else {
      paragraphs.push(`Meanwhile, ${d.name} is cooling off after a recent run.`);
    }
  }

  return paragraphs;
}
