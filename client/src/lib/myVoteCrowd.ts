/**
 * My Votes crowd line and the route a row opens.
 * Every field is optional so a response from the previous API
 * (no crowdPercent, no slug) keeps today's card.
 */

export interface MyVoteLinkFields {
  voteType: string;
  detail?: string | null;
  subjectId?: string | null;
  targetId?: string | null;
  slug?: string | null;
  crowdPercent?: number | null;
  choiceLabel?: string | null;
}

function roundedPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** "61% chose Cats", "You and 40% agreed", or null when the API has no share. */
export function myVoteCrowdCopy(vote: MyVoteLinkFields): string | null {
  const percent = roundedPercent(vote.crowdPercent);
  if (percent == null) return null;
  const label = (vote.choiceLabel ?? "").trim();

  if (vote.voteType === "trending_poll") {
    const choice = label.toLowerCase();
    if (choice === "agree") return `You and ${percent}% agreed`;
    if (choice === "disagree") return `You and ${percent}% disagreed`;
    if (choice === "neutral") return `You and ${percent}% were neutral`;
  }

  if (vote.voteType === "overall_rating") {
    return `${percent}% rated it like you`;
  }

  if (vote.voteType === "image_curate") {
    return `${percent}% chose this photo`;
  }

  if (label.length > 0) return `${percent}% chose ${label}`;
  return null;
}

/**
 * Card route. Person-tied votes open the profile. Matchups, polls,
 * and opinion polls need a slug. Induction without a shadow profile
 * opens the queue card. Missing fields return null — the row stays
 * a static card.
 */
export function myVoteHref(vote: MyVoteLinkFields): string | null {
  const slug = vote.slug?.trim() || null;
  const subjectId = vote.subjectId?.trim() || null;
  const targetId = vote.targetId?.trim() || null;

  switch (vote.voteType) {
    case "face_off":
      return slug ? `/vote/matchups/${slug}` : null;
    case "trending_poll":
      return slug ? `/polls/${slug}` : null;
    case "opinion_poll":
      return slug ? `/vote/opinion-polls/${slug}` : null;
    case "sentiment":
    case "value_vote":
    case "overall_rating":
    case "image_curate":
      return subjectId ? `/person/${subjectId}` : targetId ? `/person/${targetId}` : null;
    case "induction":
      if (subjectId) return `/person/${subjectId}`;
      return targetId ? `/vote/induction#induction-card-${targetId}` : null;
    default:
      return null;
  }
}
