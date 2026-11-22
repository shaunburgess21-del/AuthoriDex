/**
 * Matchup OG share image cache bust — keep server meta and client meta in sync.
 * v12: PNG cards include the live vote split.
 */
export const MATCHUP_OG_IMAGE_VERSION = "12";

/** Relative path for useDocumentMeta / og:image (prepend origin on server). */
export function matchupOgImagePath(slug: string): string {
  return `/api/og/vote/matchups/${encodeURIComponent(slug)}.png?v=${MATCHUP_OG_IMAGE_VERSION}`;
}

export interface MatchupTitleSource {
  promptText: string | null;
  title: string;
  optionAText: string;
  optionBText: string;
}

export interface MatchupTally {
  optionAPercent: number;
  optionBPercent: number;
  totalVotes: number;
}

/** Question line drawn on the card (not the document title). */
export function matchupPromptLine(m: {
  promptText: string | null;
  title: string;
}): string {
  const prompt = m.promptText?.trim();
  return prompt && prompt.length > 0 ? prompt : m.title;
}

/**
 * Document / OG title. Puts both sides in the title so the page can rank
 * for the matchup, then the question, then the brand.
 * Example: "Seal Team 6 vs Delta Force: Top tier one team? | VoxDex"
 */
export function matchupDocumentTitle(m: MatchupTitleSource): string {
  const a = m.optionAText.trim();
  const b = m.optionBText.trim();
  const vs = `${a} vs ${b}`;
  const vsKey = vs.toLowerCase();
  const title = m.title.trim();
  const prompt = (m.promptText?.trim() ?? "").replace(/\s*\|\s*VoxDex\s*$/i, "").trim();
  const promptKey = prompt.toLowerCase();
  const namesBothSides =
    !!prompt &&
    !!a &&
    !!b &&
    promptKey.includes(a.toLowerCase()) &&
    promptKey.includes(b.toLowerCase());

  let core: string;
  if (namesBothSides) {
    core = prompt;
  } else if (!prompt || promptKey === vsKey) {
    core = title && title.toLowerCase() !== vsKey ? `${vs}: ${title}` : `${vs}: who wins?`;
  } else {
    core = `${vs}: ${prompt}`;
  }
  const maxCore = 110;
  if (core.length > maxCore) {
    core = `${core.slice(0, maxCore - 1).trim()}…`;
  }
  return `${core} | VoxDex`;
}

export function matchupDocumentDescription(
  m: { optionAText: string; optionBText: string },
  tally?: MatchupTally | null,
): string {
  const vs = `${m.optionAText} vs ${m.optionBText}`;
  if (!tally || tally.totalVotes <= 0) {
    return `${vs}. Cast your vote on VoxDex.`;
  }
  const votes = tally.totalVotes.toLocaleString("en-US");
  if (tally.optionAPercent === tally.optionBPercent) {
    return `${vs} is tied at ${tally.optionAPercent}% of ${votes} votes.`;
  }
  const aLeads = tally.optionAPercent > tally.optionBPercent;
  const leader = aLeads ? m.optionAText : m.optionBText;
  const pct = aLeads ? tally.optionAPercent : tally.optionBPercent;
  return `${leader} leads with ${pct}% of ${votes} votes. ${vs}.`;
}
