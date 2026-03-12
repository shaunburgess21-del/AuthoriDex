export type Capability =
  | 'can_vote_sentiment'
  | 'can_vote_matchup'
  | 'can_vote_induction'
  | 'can_vote_curation'
  | 'can_post_insight'
  | 'can_comment'
  | 'can_predict';

export function canAccessCapability(tier: number, capability: Capability): boolean {
  switch (capability) {
    case 'can_vote_sentiment':
    case 'can_vote_matchup':
    case 'can_predict':
      return true;
    case 'can_vote_induction':
    case 'can_vote_curation':
    case 'can_post_insight':
    case 'can_comment':
      return tier >= 2;
    default:
      return false;
  }
}

export function computeCreditBalance(currentBalance: number, amount: number): number | null {
  const nextBalance = currentBalance + amount;
  return nextBalance < 0 ? null : nextBalance;
}
