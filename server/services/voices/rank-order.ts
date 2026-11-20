import { normalizeMarketCategory } from "@shared/constants";

export type VoicesRankMode = "for-you" | "latest" | "top";

/** Each reply is worth this many net upvotes when scoring engagement. */
const REPLY_WEIGHT = 1.5;
/** Hacker-News style time-decay exponent. */
const GRAVITY = 1.45;
/** Max items surfaced per parent entity in for-you / top (diversity cap). */
const MAX_PER_ENTITY = 3;
/** Rising = young + already gathering engagement. */
const RISING_MAX_AGE_HOURS = 36;
const RISING_MIN_ENGAGEMENT = 4;
const INTEREST_BOOST = 0.5;
const FAVORITE_BOOST = 0.75;

/** Standalone timeline posts share one parent; they are not "top takes". */
const TIMELINE_ENTITY_KEY = "timeline:global";

export interface RankableVoice {
  id: string;
  entityRefKey: string;
  upvotes: number;
  downvotes: number;
  replyCount: number;
  createdAtMs: number;
  authorUserId: string;
  category: string | null;
  personIds: string[];
}

export interface RankPersonalization {
  interests: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
}

export interface RankedVoiceRef {
  id: string;
  score: number;
  topTake: boolean;
  rising: boolean;
}

function engagementOf(c: RankableVoice): number {
  return c.upvotes - c.downvotes + c.replyCount * REPLY_WEIGHT;
}

function hotScore(c: RankableVoice, now: number): number {
  const ageHours = Math.max(0, (now - c.createdAtMs) / 3_600_000);
  return (engagementOf(c) + 1) / Math.pow(ageHours + 2, GRAVITY);
}

function personalBoost(c: RankableVoice, p: RankPersonalization): number {
  let boost = 0;
  if (c.category && p.interests.has(normalizeMarketCategory(c.category))) {
    boost += INTEREST_BOOST;
  }
  if (c.personIds.some((id) => p.favorites.has(id))) {
    boost += FAVORITE_BOOST;
  }
  return boost;
}

/**
 * Order a candidate set for one feed mode.
 *
 * - latest: strict reverse-chronological (createdAt). No per-entity cap.
 * - top: net engagement.
 * - for-you: time-decayed hot score, with interest/favourite boosts.
 *
 * The viewer's own posts skip the diversity cap so a just-published post
 * is not dropped behind three older posts on the same card or timeline.
 */
export function rankVoiceOrder(
  items: RankableVoice[],
  opts: {
    mode: VoicesRankMode;
    now: number;
    userId: string | null;
    personalization?: RankPersonalization;
  },
): RankedVoiceRef[] {
  const personalization = opts.personalization ?? {
    interests: new Set<string>(),
    favorites: new Set<string>(),
  };

  const scored = items.map((c) => {
    let score: number;
    if (opts.mode === "latest") {
      score = c.createdAtMs;
    } else if (opts.mode === "top") {
      score = engagementOf(c);
    } else {
      score = hotScore(c, opts.now) * (1 + personalBoost(c, personalization));
    }
    const ageHours = Math.max(0, (opts.now - c.createdAtMs) / 3_600_000);
    const rising = ageHours <= RISING_MAX_AGE_HOURS && engagementOf(c) >= RISING_MIN_ENGAGEMENT;
    return { c, score, rising };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.c.createdAtMs - a.c.createdAtMs;
  });

  const seenTopTake = new Set<string>();
  const perEntityCount = new Map<string, number>();
  const applyCap = opts.mode !== "latest";
  const out: RankedVoiceRef[] = [];

  for (const s of scored) {
    const key = s.c.entityRefKey;
    const isTopTake = key !== TIMELINE_ENTITY_KEY && !seenTopTake.has(key);
    if (isTopTake) seenTopTake.add(key);

    const isOwn = opts.userId != null && s.c.authorUserId === opts.userId;
    if (applyCap && !isOwn) {
      const cnt = perEntityCount.get(key) ?? 0;
      if (cnt >= MAX_PER_ENTITY) continue;
      perEntityCount.set(key, cnt + 1);
    }

    out.push({ id: s.c.id, score: s.score, topTake: isTopTake, rising: s.rising });
  }

  return out;
}

/**
 * Hidden comments stay out of everyone else's feed. The author still sees
 * their own held post, flagged pending review. There is no separate
 * new-account hold — only moderation status `hidden`.
 */
export function voiceVisibleToViewer(
  moderationStatus: "visible" | "hidden" | null | undefined,
  authorId: string,
  viewerId: string | null,
): { include: boolean; pendingReview: boolean } {
  if (moderationStatus !== "hidden") {
    return { include: true, pendingReview: false };
  }
  if (viewerId != null && viewerId === authorId) {
    return { include: true, pendingReview: true };
  }
  return { include: false, pendingReview: false };
}
