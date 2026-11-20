/**
 * One-sentence explanations for terms a new user hits without context.
 * Keep each line to a single sentence. UI chrome reads this map — don't
 * duplicate the copy next to the icon.
 */
export const GLOSSARY = {
  trendScore:
    "Trend Score is how much public attention someone is getting right now, not whether people like them.",
  xp:
    "XP is experience you earn by voting and predicting, and it only moves your rank.",
  vox:
    "Vox is VoxDex's virtual currency for predictions, and it has no cash value.",
  pnl:
    "P&L is your profit or loss in Vox on this position so far.",
  shares:
    "A share is a slice of an outcome, and each winning share pays 1 Vox when the market closes.",
  h2h:
    "Head-to-Head is a pick on which of two people will finish the week with the higher Trend Score.",
  inductionQueue:
    "The Induction Queue is where you vote on who should join the main leaderboard.",
  curateProfile:
    "Curate Profile is where you vote for the photo that should represent someone.",
  approval:
    "Approval is the community's 1 to 5 rating of someone, separate from their Trend Score.",
  wikiSignal:
    "Wiki is how much their Wikipedia pageviews changed compared with their recent baseline.",
  newsSignal:
    "News is how much coverage of them changed compared with their recent baseline.",
  categoryRank:
    "Category rank is their place among people in the same category.",
  overallRank:
    "Overall rank is their place across everyone on the leaderboard.",
  neutralShare:
    "Neutral is the share of votes that picked neither side.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossarySentence(key: GlossaryKey): string {
  return GLOSSARY[key];
}
