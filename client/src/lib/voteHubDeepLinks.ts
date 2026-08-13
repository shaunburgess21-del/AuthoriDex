/**
 * Vote hub (/vote) section deep links. Hash IDs must match VotePage section roots.
 */
export const VOTE_HUB_DEEP_LINKS = [
  {
    hashId: "vote-sentiment",
    label: "Sentiment Polls",
    href: "/vote#vote-sentiment",
    sectionToggle: "Sentiment Polls",
  },
  {
    hashId: "vote-matchups",
    label: "Matchups",
    href: "/vote#vote-matchups",
    sectionToggle: "Matchups",
  },
  {
    hashId: "vote-opinion",
    label: "Opinion Polls",
    href: "/vote#vote-opinion",
    sectionToggle: "Opinion Polls",
  },
  {
    hashId: "vote-rating",
    label: "Overall Rating",
    href: "/vote#vote-rating",
    sectionToggle: "Overall Rating",
  },
  {
    hashId: "vote-induction",
    label: "Induction Queue",
    href: "/vote#vote-induction",
    sectionToggle: "Induction Queue",
  },
  {
    hashId: "vote-curate",
    label: "Curate Profile Image",
    href: "/vote#vote-curate",
    sectionToggle: "Curate Profile",
  },
] as const;

export type VoteHubDeepLink = (typeof VOTE_HUB_DEEP_LINKS)[number];
export type VoteHubSectionToggle = VoteHubDeepLink["sectionToggle"];

/** Map `#vote-sentiment` or `vote-sentiment` to the Vote hub chip value. */
export function voteHubSectionFromHash(rawHash: string): VoteHubSectionToggle | null {
  const id = rawHash.replace(/^#/, "");
  const row = VOTE_HUB_DEEP_LINKS.find((l) => l.hashId === id);
  return row ? row.sectionToggle : null;
}
