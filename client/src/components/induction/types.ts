/** Row shape returned by GET /api/vote/induction (active candidates only). */
export interface InductionCandidate {
  id: string;
  displayName: string;
  category: string;
  imageSlug: string | null;
  avatar: string | null;
  seedVotes: number;
  wikiSlug: string | null;
  xHandle: string | null;
  instagramHandle: string | null;
  tiktokHandle: string | null;
  youtubeId: string | null;
  isActive: boolean;
  /** Shadow tracked_people id — target of the dormant /person/:id profile page. */
  personId: string | null;
  /** Visible comments on that person's profile thread. 0 when there is no shadow profile. */
  commentCount?: number;
}

export interface InductionAPIResponse {
  data: InductionCandidate[];
  totalCount: number;
}

/** A candidate with its global queue position (1 = most votes). */
export interface RankedCandidate extends InductionCandidate {
  rank: number;
}
