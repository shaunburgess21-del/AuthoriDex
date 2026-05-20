import { coalesceHttpImage } from "@/lib/displayImageUrl";

export type OpinionThumbParticipant = {
  name: string;
  avatar: string | null;
};

type OpinionOptionLike = {
  name?: string;
  imageUrl?: string | null;
  votes?: number;
  displayVotes?: number;
};

/**
 * Top opinion-poll options by vote count for carousel grid thumbs.
 */
export function getTopOpinionOptionThumbs(
  options: OpinionOptionLike[] | null | undefined,
  limit = 4,
): OpinionThumbParticipant[] {
  const list = Array.isArray(options) ? options : [];
  if (list.length === 0) return [];

  return list
    .map((o) => ({
      name: o.name ?? "?",
      avatar: coalesceHttpImage(o.imageUrl),
      votes: Number(o.displayVotes ?? o.votes ?? 0),
    }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit)
    .map(({ name, avatar }) => ({ name, avatar }));
}

/** True when at least two options have http(s) image URLs. */
export function hasMultipleOptionImages(
  participants: OpinionThumbParticipant[],
): boolean {
  const withImage = participants.filter((p) => p.avatar);
  return withImage.length >= 2;
}
