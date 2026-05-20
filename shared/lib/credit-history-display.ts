/**
 * Pure credit-ledger display builders (no DB). Used by the server
 * enrichment layer and unit tests.
 */

import { labelForTxnType } from "@shared/credit-config";
import { getRecentActivityMarketPath } from "@shared/lib/market-paths";

export interface CreditHistoryDisplayFields {
  displayTitle: string;
  displaySubtitle?: string;
  href?: string;
}

export type LedgerMetadata = Record<string, unknown>;

export function asMetadata(raw: unknown): LedgerMetadata | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as LedgerMetadata;
  }
  return null;
}

export function metaString(meta: LedgerMetadata | null, key: string): string | null {
  const v = meta?.[key];
  if (v == null) return null;
  return String(v);
}

function formatShares(shares: unknown): string | null {
  if (shares == null) return null;
  const n = Number(shares);
  if (!Number.isFinite(n)) return null;
  return Math.round(n).toLocaleString("en-US");
}

export function buildAmmTradeDisplay(
  txnType: "amm_buy" | "amm_sell",
  metadata: LedgerMetadata | null,
  market?: { title: string; slug: string | null; marketType: string | null; id: string } | null,
  entry?: { label: string } | null,
): CreditHistoryDisplayFields {
  const sharesLabel = formatShares(metadata?.shares);
  const entryLabel = entry?.label;
  const marketTitle = market?.title;

  const action =
    txnType === "amm_buy"
      ? sharesLabel
        ? `Bought ${sharesLabel} shares`
        : "Bought shares"
      : sharesLabel
        ? `Sold ${sharesLabel} shares`
        : "Sold shares";

  // Mirror Town Square feed copy: "bought N shares of {choice} on {market}".
  let displayTitle: string;
  if (entryLabel && marketTitle) {
    displayTitle = `${action} of ${entryLabel} on ${marketTitle}`;
  } else if (marketTitle) {
    displayTitle = `${action} on ${marketTitle}`;
  } else if (entryLabel) {
    displayTitle = `${action} of ${entryLabel}`;
  } else if (sharesLabel) {
    displayTitle = action;
  } else {
    displayTitle = labelForTxnType(txnType);
  }

  const hasRichTitle = !!(entryLabel || marketTitle || sharesLabel);

  const href =
    market != null
      ? getRecentActivityMarketPath(market.slug, market.marketType, market.id)
      : undefined;

  return {
    displayTitle,
    displaySubtitle: hasRichTitle
      ? undefined
      : txnType === "amm_buy"
        ? "Prediction purchase"
        : "Prediction sale",
    href,
  };
}

const VOTE_SURFACE_LABELS: Record<string, string> = {
  sentiment: "Sentiment vote",
  curation: "Image curation vote",
  value: "Value rating",
  matchup: "Matchup vote",
  trending_poll: "Sentiment poll vote",
  opinion_poll: "Opinion poll vote",
  induction: "Induction vote",
};

export function buildVoteDisplay(
  metadata: LedgerMetadata | null,
  context?: {
    personName?: string | null;
    matchupTitle?: string | null;
    pollHeadline?: string | null;
    pollTitle?: string | null;
    candidateName?: string | null;
    matchupSlug?: string | null;
    opinionPollSlug?: string | null;
    trendingPollSlug?: string | null;
  },
): CreditHistoryDisplayFields {
  const voteType = metaString(metadata, "voteType") ?? "";
  const surfaceLabel = VOTE_SURFACE_LABELS[voteType] ?? "Vote";

  let subject: string | null = null;
  if (context?.personName) {
    subject = context.personName;
  } else if (context?.matchupTitle) {
    subject = context.matchupTitle;
    const choice = metaString(metadata, "votedOption") ?? metaString(metadata, "choice");
    if (choice) subject = `${subject} (${choice})`;
  } else if (context?.pollHeadline) {
    subject = context.pollHeadline;
    const choice = metaString(metadata, "choice");
    if (choice) subject = `${subject} (${choice})`;
  } else if (context?.pollTitle) {
    subject = context.pollTitle;
  } else if (context?.candidateName) {
    subject = context.candidateName;
  }

  const displayTitle = subject ? `${subject}` : surfaceLabel;

  let href: string | undefined = "/vote";
  if (voteType === "induction") {
    href = "/vote/induction";
  } else if (voteType === "matchup" && context?.matchupSlug) {
    href = `/vote/matchups/${context.matchupSlug}`;
  } else if (voteType === "opinion_poll" && context?.opinionPollSlug) {
    href = `/vote/opinion-polls/${context.opinionPollSlug}`;
  } else if (voteType === "trending_poll" && context?.trendingPollSlug) {
    href = `/polls/${context.trendingPollSlug}`;
  } else if (voteType === "sentiment") {
    const pid = metaString(metadata, "personId");
    if (pid) href = `/person/${pid}`;
  } else if (voteType === "value") {
    href = "/vote/value-ratings";
  }

  return {
    displayTitle,
    displaySubtitle: subject ? surfaceLabel : "Vote reward",
    href,
  };
}

export function buildLedgerDisplayFallback(
  txnType: string,
  _amount: number,
  metadata: LedgerMetadata | null,
): CreditHistoryDisplayFields {
  const baseLabel = labelForTxnType(txnType);

  if (txnType === "amm_buy" || txnType === "amm_sell") {
    return buildAmmTradeDisplay(txnType, metadata, null, null);
  }

  if (txnType === "vote_any") {
    return buildVoteDisplay(metadata);
  }

  const marketId = metaString(metadata, "marketId");
  if (
    marketId &&
    (txnType === "prediction_stake" ||
      txnType === "prediction_payout" ||
      txnType === "prediction_refund")
  ) {
    return {
      displayTitle: baseLabel,
      displaySubtitle: undefined,
      href: undefined,
    };
  }

  if (txnType === "admin_adjustment") {
    const reason = metaString(metadata, "reason");
    return {
      displayTitle: reason ? `Admin adjustment: ${reason}` : baseLabel,
    };
  }

  return { displayTitle: baseLabel };
}

export const LEDGER_LABEL_MAX = 80;

export function truncateLedgerLabel(text: string, maxLen = LEDGER_LABEL_MAX): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

export function buildPostInsightDisplay(
  content: string | null | undefined,
  personName: string | null | undefined,
  personId: string | null | undefined,
): CreditHistoryDisplayFields {
  const baseLabel = labelForTxnType("post_insight");
  if (!content?.trim()) {
    return { displayTitle: baseLabel };
  }
  return {
    displayTitle: truncateLedgerLabel(content),
    displaySubtitle: personName
      ? `Posted insight · ${personName}`
      : "Posted insight",
    href: personId ? `/person/${personId}` : undefined,
  };
}

export function buildCommentInsightDisplay(
  body: string | null | undefined,
  personName: string | null | undefined,
  personId: string | null | undefined,
): CreditHistoryDisplayFields {
  const baseLabel = labelForTxnType("comment_insight");
  if (!body?.trim()) {
    return { displayTitle: baseLabel };
  }
  return {
    displayTitle: truncateLedgerLabel(body),
    displaySubtitle: personName
      ? `Comment on insight · ${personName}`
      : "Comment on insight",
    href: personId ? `/person/${personId}` : undefined,
  };
}
