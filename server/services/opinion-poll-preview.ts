import { asc, count, inArray } from "drizzle-orm";
import { db } from "../db";
import { opinionPollOptions, opinionPollVotes } from "@shared/schema";

const TOP_OPTION_COUNT = 3;

export interface VoicesOpinionPreviewOption {
  name: string;
  percent: number;
  votes: number;
}

/** Top leading options for Voices opinion poll link cards. */
export interface VoicesOpinionPreview {
  totalOptions: number;
  totalVotes: number;
  topOptions: VoicesOpinionPreviewOption[];
}

interface OptionRow {
  pollId: string;
  id: string;
  name: string;
  orderIndex: number;
  seedCount: number;
}

function sortByVotesDesc(a: OptionRow & { displayVotes: number }, b: OptionRow & { displayVotes: number }) {
  return b.displayVotes - a.displayVotes || a.orderIndex - b.orderIndex;
}

/**
 * Batch-load top option results for opinion poll previews on the Voices feed.
 * Mirrors display vote math in GET /api/opinion-polls (seed + real votes).
 */
export async function loadOpinionPollPreview(
  pollIds: string[],
): Promise<Map<string, VoicesOpinionPreview>> {
  const out = new Map<string, VoicesOpinionPreview>();
  if (pollIds.length === 0) return out;

  const optionRows = await db
    .select({
      pollId: opinionPollOptions.pollId,
      id: opinionPollOptions.id,
      name: opinionPollOptions.name,
      orderIndex: opinionPollOptions.orderIndex,
      seedCount: opinionPollOptions.seedCount,
    })
    .from(opinionPollOptions)
    .where(inArray(opinionPollOptions.pollId, pollIds))
    .orderBy(asc(opinionPollOptions.pollId), asc(opinionPollOptions.orderIndex));

  if (optionRows.length === 0) return out;

  const voteCounts = await db
    .select({
      optionId: opinionPollVotes.optionId,
      cnt: count(),
    })
    .from(opinionPollVotes)
    .where(inArray(opinionPollVotes.pollId, pollIds))
    .groupBy(opinionPollVotes.optionId);

  const realVotesByOptionId = new Map(voteCounts.map((v) => [v.optionId, Number(v.cnt)]));

  const optionsByPoll = new Map<string, OptionRow[]>();
  for (const row of optionRows) {
    const list = optionsByPoll.get(row.pollId) ?? [];
    list.push(row);
    optionsByPoll.set(row.pollId, list);
  }

  for (const pollId of pollIds) {
    const options = optionsByPoll.get(pollId) ?? [];
    if (options.length === 0) continue;

    const withVotes = options.map((o) => {
      const displayVotes = (o.seedCount || 0) + (realVotesByOptionId.get(o.id) || 0);
      return { ...o, displayVotes };
    });
    const totalVotes = withVotes.reduce((sum, o) => sum + o.displayVotes, 0);
    if (totalVotes <= 0) continue;

    const sorted = [...withVotes].sort(sortByVotesDesc);
    const topOptions = sorted.slice(0, TOP_OPTION_COUNT).map((o) => ({
      name: o.name,
      votes: o.displayVotes,
      percent: Math.round((o.displayVotes / totalVotes) * 100),
    }));

    out.set(pollId, {
      totalOptions: options.length,
      totalVotes,
      topOptions,
    });
  }

  return out;
}
