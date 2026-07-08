/**
 * Enriches credit_ledger rows with user-facing titles and deep links.
 * The Vox amount itself is rendered at the call site via the
 * `formatVox` helpers in `shared/currency.ts`; this layer just hangs
 * the contextual label and href on each row.
 */

import { db } from "../db";
import {
  comments,
  inductionCandidates,
  marketEntries,
  matchups,
  opinionPolls,
  predictionMarkets,
  trackedPeople,
  trendingPolls,
  type CreditLedger,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { labelForTxnType } from "@shared/credit-config";
import { getRecentActivityMarketPath } from "@shared/lib/market-paths";
import {
  asMetadata,
  buildAmmTradeDisplay,
  buildCommentInsightDisplay,
  buildLedgerDisplayFallback,
  buildPostInsightDisplay,
  buildVoteDisplay,
  metaString,
  type CreditHistoryDisplayFields,
} from "@shared/lib/credit-history-display";

export type { CreditHistoryDisplayFields } from "@shared/lib/credit-history-display";
export {
  buildAmmTradeDisplay,
  buildCommentInsightDisplay,
  buildPostInsightDisplay,
  buildVoteDisplay,
  buildLedgerDisplayFallback,
} from "@shared/lib/credit-history-display";

export type EnrichedCreditLedgerRow = CreditLedger & CreditHistoryDisplayFields;

export async function enrichCreditHistoryRows(
  entries: CreditLedger[],
): Promise<EnrichedCreditLedgerRow[]> {
  if (entries.length === 0) return [];

  const marketIds = new Set<string>();
  const entryIds = new Set<string>();
  const personIds = new Set<string>();
  const matchupIds = new Set<string>();
  const trendingPollIds = new Set<string>();
  const opinionPollIds = new Set<string>();
  const inductionIds = new Set<string>();
  const communityInsightIds = new Set<string>();
  const commentIds = new Set<string>();

  for (const row of entries) {
    const meta = asMetadata(row.metadata);
    const txn = row.txnType;

    if (txn === "amm_buy" || txn === "amm_sell") {
      const mid = metaString(meta, "marketId");
      const eid = metaString(meta, "entryId");
      if (mid) marketIds.add(mid);
      if (eid) entryIds.add(eid);
    }

    if (
      txn === "prediction_stake" ||
      txn === "prediction_payout" ||
      txn === "prediction_refund"
    ) {
      const mid = metaString(meta, "marketId");
      if (mid) marketIds.add(mid);
    }

    if (txn === "vote_any" && meta) {
      const voteType = metaString(meta, "voteType") ?? "";
      const entityId = metaString(meta, "entityId");

      if (voteType === "sentiment" || voteType === "curation") {
        const pid = metaString(meta, "personId");
        if (pid) personIds.add(pid);
      } else if (voteType === "value") {
        const cid = metaString(meta, "celebrityId") ?? entityId;
        if (cid) personIds.add(cid);
      } else if (voteType === "matchup" && entityId) {
        matchupIds.add(entityId);
      } else if (voteType === "trending_poll" && entityId) {
        trendingPollIds.add(entityId);
      } else if (voteType === "opinion_poll" && entityId) {
        opinionPollIds.add(entityId);
      } else if (voteType === "induction" && entityId) {
        inductionIds.add(entityId);
      }
    }

    if (txn === "post_insight") {
      const iid = metaString(meta, "insightId");
      if (iid) communityInsightIds.add(iid);
      const pid = metaString(meta, "personId");
      if (pid) personIds.add(pid);
    }

    if (txn === "comment_insight") {
      const cid = metaString(meta, "commentId");
      if (cid) commentIds.add(cid);
      const iid = metaString(meta, "insightId");
      if (iid) communityInsightIds.add(iid);
    }
  }

  const [
    marketRows,
    entryRows,
    personRows,
    matchupRows,
    trendingRows,
    opinionRows,
    inductionRows,
    insightRows,
    commentRows,
  ] = await Promise.all([
    marketIds.size > 0
      ? db
          .select({
            id: predictionMarkets.id,
            title: predictionMarkets.title,
            slug: predictionMarkets.slug,
            marketType: predictionMarkets.marketType,
          })
          .from(predictionMarkets)
          .where(inArray(predictionMarkets.id, [...marketIds]))
      : Promise.resolve([]),
    entryIds.size > 0
      ? db
          .select({ id: marketEntries.id, label: marketEntries.label })
          .from(marketEntries)
          .where(inArray(marketEntries.id, [...entryIds]))
      : Promise.resolve([]),
    personIds.size > 0
      ? db
          .select({ id: trackedPeople.id, name: trackedPeople.name })
          .from(trackedPeople)
          .where(inArray(trackedPeople.id, [...personIds]))
      : Promise.resolve([]),
    matchupIds.size > 0
      ? db
          .select({
            id: matchups.id,
            title: matchups.title,
            slug: matchups.slug,
          })
          .from(matchups)
          .where(inArray(matchups.id, [...matchupIds]))
      : Promise.resolve([]),
    trendingPollIds.size > 0
      ? db
          .select({
            id: trendingPolls.id,
            headline: trendingPolls.headline,
            slug: trendingPolls.slug,
          })
          .from(trendingPolls)
          .where(inArray(trendingPolls.id, [...trendingPollIds]))
      : Promise.resolve([]),
    opinionPollIds.size > 0
      ? db
          .select({
            id: opinionPolls.id,
            title: opinionPolls.title,
            slug: opinionPolls.slug,
          })
          .from(opinionPolls)
          .where(inArray(opinionPolls.id, [...opinionPollIds]))
      : Promise.resolve([]),
    inductionIds.size > 0
      ? db
          .select({
            id: inductionCandidates.id,
            displayName: inductionCandidates.displayName,
          })
          .from(inductionCandidates)
          .where(inArray(inductionCandidates.id, [...inductionIds]))
      : Promise.resolve([]),
    communityInsightIds.size > 0
      ? db
          .select({
            id: comments.id,
            personId: comments.parentId,
            content: comments.body,
            personName: trackedPeople.name,
          })
          .from(comments)
          .innerJoin(trackedPeople, eq(comments.parentId, trackedPeople.id))
          .where(and(
            inArray(comments.id, [...communityInsightIds]),
            eq(comments.parentType, "community_insight"),
          ))
      : Promise.resolve([]),
    commentIds.size > 0
      ? db
          .select({
            id: comments.id,
            body: comments.body,
            parentId: comments.parentId,
            parentType: comments.parentType,
          })
          .from(comments)
          .where(inArray(comments.id, [...commentIds]))
      : Promise.resolve([]),
  ]);

  const marketMap = new Map(marketRows.map((m) => [m.id, m]));
  const entryMap = new Map(entryRows.map((e) => [e.id, e]));
  const personMap = new Map(personRows.map((p) => [p.id, p]));
  const matchupMap = new Map(matchupRows.map((m) => [m.id, m]));
  const trendingMap = new Map(trendingRows.map((p) => [p.id, p]));
  const opinionMap = new Map(opinionRows.map((p) => [p.id, p]));
  const inductionMap = new Map(inductionRows.map((c) => [c.id, c]));
  const insightMap = new Map(insightRows.map((i) => [i.id, i]));
  const commentMap = new Map(commentRows.map((c) => [c.id, c]));

  return entries.map((row) => {
    const meta = asMetadata(row.metadata);
    const fields = resolveRowDisplay(row, meta, {
      marketMap,
      entryMap,
      personMap,
      matchupMap,
      trendingMap,
      opinionMap,
      inductionMap,
      insightMap,
      commentMap,
    });
    return { ...row, ...fields };
  });
}

function resolveRowDisplay(
  row: CreditLedger,
  meta: ReturnType<typeof asMetadata>,
  maps: {
    marketMap: Map<string, { id: string; title: string; slug: string | null; marketType: string | null }>;
    entryMap: Map<string, { label: string }>;
    personMap: Map<string, { name: string }>;
    matchupMap: Map<string, { title: string; slug: string | null }>;
    trendingMap: Map<string, { headline: string; slug: string | null }>;
    opinionMap: Map<string, { title: string; slug: string | null }>;
    inductionMap: Map<string, { displayName: string }>;
    insightMap: Map<
      string,
      { id: string; personId: string; content: string; personName: string }
    >;
    commentMap: Map<string, { id: string; body: string; parentId: string; parentType: string }>;
  },
): CreditHistoryDisplayFields {
  const { txnType } = row;

  if (txnType === "amm_buy" || txnType === "amm_sell") {
    const marketId = metaString(meta, "marketId");
    const entryId = metaString(meta, "entryId");
    return buildAmmTradeDisplay(
      txnType,
      meta,
      marketId ? maps.marketMap.get(marketId) ?? null : null,
      entryId ? maps.entryMap.get(entryId) ?? null : null,
    );
  }

  if (txnType === "vote_any") {
    const voteType = metaString(meta, "voteType") ?? "";
    const entityId = metaString(meta, "entityId");
    let personName: string | null = null;
    if (voteType === "sentiment" || voteType === "curation") {
      const pid = metaString(meta, "personId");
      personName = pid ? maps.personMap.get(pid)?.name ?? null : null;
    } else if (voteType === "value") {
      const cid = metaString(meta, "celebrityId") ?? entityId;
      personName = cid ? maps.personMap.get(cid)?.name ?? null : null;
    }
    const matchup = entityId && voteType === "matchup" ? maps.matchupMap.get(entityId) : undefined;
    const trending =
      entityId && voteType === "trending_poll" ? maps.trendingMap.get(entityId) : undefined;
    const opinion =
      entityId && voteType === "opinion_poll" ? maps.opinionMap.get(entityId) : undefined;
    const candidate =
      entityId && voteType === "induction" ? maps.inductionMap.get(entityId) : undefined;

    return buildVoteDisplay(meta, {
      personName,
      matchupTitle: matchup?.title ?? null,
      matchupSlug: matchup?.slug ?? null,
      pollHeadline: trending?.headline ?? null,
      pollTitle: opinion?.title ?? null,
      opinionPollSlug: opinion?.slug ?? null,
      trendingPollSlug: trending?.slug ?? null,
      candidateName: candidate?.displayName ?? null,
    });
  }

  if (txnType === "post_insight") {
    const insightId = metaString(meta, "insightId");
    const insight = insightId ? maps.insightMap.get(insightId) : undefined;
    const personId = insight?.personId ?? metaString(meta, "personId");
    const personName =
      insight?.personName ??
      (personId ? maps.personMap.get(personId)?.name ?? null : null);
    return buildPostInsightDisplay(
      insight?.content,
      personName,
      personId,
    );
  }

  if (txnType === "comment_insight") {
    const commentId = metaString(meta, "commentId");
    const comment = commentId ? maps.commentMap.get(commentId) : undefined;
    const insightId =
      metaString(meta, "insightId") ??
      (comment?.parentType === "community_insight" ? comment.parentId : null);
    const insight = insightId ? maps.insightMap.get(insightId) : undefined;
    return buildCommentInsightDisplay(
      comment?.body,
      insight?.personName ?? null,
      insight?.personId,
    );
  }

  if (
    txnType === "prediction_stake" ||
    txnType === "prediction_payout" ||
    txnType === "prediction_refund"
  ) {
    const marketId = metaString(meta, "marketId");
    const market = marketId ? maps.marketMap.get(marketId) : undefined;
    const baseLabel = labelForTxnType(txnType);
    return {
      displayTitle: market?.title ?? baseLabel,
      displaySubtitle: market?.title ? baseLabel : undefined,
      href: market
        ? getRecentActivityMarketPath(market.slug, market.marketType, market.id)
        : undefined,
    };
  }

  return buildLedgerDisplayFallback(txnType, row.amount, meta);
}
