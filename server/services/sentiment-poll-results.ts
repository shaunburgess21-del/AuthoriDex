import { count, inArray } from "drizzle-orm";
import { db } from "../db";
import { trendingPolls, trendingPollVotes } from "@shared/schema";
import { normalizeSentimentChoice } from "@shared/lib/sentiment-poll-choice";

/** Agree/neutral/disagree percentages for Voices sentiment poll link cards. */
export interface VoicesSentimentResults {
  agreePercent: number;
  neutralPercent: number;
  disagreePercent: number;
}

function toPercents(agree: number, neutral: number, disagree: number): VoicesSentimentResults {
  const total = agree + neutral + disagree;
  if (total <= 0) {
    return { agreePercent: 0, neutralPercent: 0, disagreePercent: 0 };
  }
  return {
    agreePercent: Math.round((agree / total) * 100),
    neutralPercent: Math.round((neutral / total) * 100),
    disagreePercent: Math.round((disagree / total) * 100),
  };
}

/**
 * Batch-load vote distribution for sentiment poll previews on the Voices feed.
 * Mirrors the percent math in GET /api/polls (seed counts + real votes).
 */
export async function loadSentimentPollResults(
  pollIds: string[],
): Promise<Map<string, VoicesSentimentResults>> {
  const out = new Map<string, VoicesSentimentResults>();
  if (pollIds.length === 0) return out;

  const polls = await db
    .select({
      id: trendingPolls.id,
      seedAgreeCount: trendingPolls.seedAgreeCount,
      seedNeutralCount: trendingPolls.seedNeutralCount,
      seedDisagreeCount: trendingPolls.seedDisagreeCount,
    })
    .from(trendingPolls)
    .where(inArray(trendingPolls.id, pollIds));

  if (polls.length === 0) return out;

  const realCountsByPoll = new Map<string, { agree: number; neutral: number; disagree: number }>();
  const voteRows = await db
    .select({
      pollId: trendingPollVotes.pollId,
      choice: trendingPollVotes.choice,
      cnt: count(),
    })
    .from(trendingPollVotes)
    .where(inArray(trendingPollVotes.pollId, pollIds))
    .groupBy(trendingPollVotes.pollId, trendingPollVotes.choice);

  for (const row of voteRows) {
    const bucket = realCountsByPoll.get(row.pollId) ?? { agree: 0, neutral: 0, disagree: 0 };
    const normalized = normalizeSentimentChoice(String(row.choice));
    if (normalized) {
      bucket[normalized] = Number(row.cnt);
    }
    realCountsByPoll.set(row.pollId, bucket);
  }

  for (const p of polls) {
    const real = realCountsByPoll.get(p.id) ?? { agree: 0, neutral: 0, disagree: 0 };
    const agreeCount = (p.seedAgreeCount || 0) + real.agree;
    const neutralCount = (p.seedNeutralCount || 0) + real.neutral;
    const disagreeCount = (p.seedDisagreeCount || 0) + real.disagree;
    out.set(p.id, toPercents(agreeCount, neutralCount, disagreeCount));
  }

  return out;
}
