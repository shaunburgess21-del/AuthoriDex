import { toast } from "sonner";
import type {
  ShareCardData,
  ShareCardTradeData,
  ShareCardPositionData,
} from "@/components/share/ShareCard";
import { appendShareAttribution } from "@/lib/share";
import { formatVox, voxWord } from "@/lib/currency";

/**
 * Helpers that map page-local state into the `ShareCardTradeData` /
 * `ShareCardPositionData` payloads expected by the share modal.
 *
 * Why this lives in its own file:
 *   - The 4 AMM detail pages (UpDown, H2H, Race, community) all need to
 *     build identical `trade` payloads on buy/sell success. Copy-pasted
 *     constructors drift; this module is the single source.
 *   - The /me/predictions Open tab and /u/<user> Open Positions section
 *     both build `position` payloads from the same shape returned by
 *     `loadAmmPositionsFor` (Sprint 1). Same de-drift argument.
 *
 * Note: callers still own the `fallbackText` / `shareUrl` / `filenameBase`
 * around the data — those are per-context (share URL on a buy points at
 * the market, on a position points at /u/<user>, etc.).
 */

export interface BuildTradeShareArgs {
  /** "buy" or "sell" — drives headline copy + accent. */
  actionType: "buy" | "sell";
  /** Username to attribute the share to (used by Open Graph helpers later). */
  username: string;
  /** Person info for the avatar hero. Null is fine — falls back to initials. */
  personName: string | null;
  personAvatar: string | null;
  marketTitle: string;
  category?: string | null;
  /** Display label of the entry traded ("UP", "DOWN", candidate name, "Yes"). */
  entryLabel: string;
  direction: "up" | "down" | "other";
  /**
   * Shares from the AMM trade response. Buy: `sharesPurchased`.
   * Sell:  `sharesSold` (or `sharesPurchased` for legacy responses where
   * the sell route reused the same field — caller normalises).
   */
  shares: number;
  /**
   * Average fill price for this trade. The AMM trade response returns
   * `pricePerShare` already in 0..1.
   */
  pricePerShare: number;
  /**
   * Buy: `chargeCredits` (Vox debited).
   * Sell: `payoutAmount` or `proceeds` (Vox credited).
   */
  stakeAmount: number;
}

export function buildTradeShareData(
  args: BuildTradeShareArgs,
): ShareCardTradeData {
  const shares = Number.isFinite(args.shares) ? Math.max(0, args.shares) : 0;
  return {
    variant: "trade",
    actionType: args.actionType,
    username: args.username,
    personName: args.personName,
    personAvatar: args.personAvatar,
    marketTitle: args.marketTitle,
    category: args.category ?? null,
    entryLabel: args.entryLabel,
    direction: args.direction,
    shares,
    pricePerShare: Number.isFinite(args.pricePerShare)
      ? Math.max(0, Math.min(1, args.pricePerShare))
      : 0,
    stakeAmount: Number.isFinite(args.stakeAmount)
      ? Math.max(0, Math.round(args.stakeAmount))
      : 0,
    // Only meaningful for buys — share = Ꝟ1 at settlement, so the floor
    // of shares is the payout-if-win headline. For sells we omit it.
    potentialPayout:
      args.actionType === "buy" ? Math.max(0, Math.floor(shares)) : undefined,
  };
}

export interface BuildPositionShareArgs {
  username: string;
  personName: string | null;
  personAvatar: string | null;
  marketTitle: string;
  category?: string | null;
  entryLabel: string;
  direction: "up" | "down" | "other";
  netShares: number;
  avgEntryPrice: number;
  currentPrice: number;
  costBasis: number;
  currentValue: number;
  endAt: string;
}

export function buildPositionShareData(
  args: BuildPositionShareArgs,
): ShareCardPositionData {
  const netShares = Number.isFinite(args.netShares) ? Math.max(0, args.netShares) : 0;
  return {
    variant: "position",
    username: args.username,
    personName: args.personName,
    personAvatar: args.personAvatar,
    marketTitle: args.marketTitle,
    category: args.category ?? null,
    entryLabel: args.entryLabel,
    direction: args.direction,
    netShares,
    avgEntryPrice: clamp01(args.avgEntryPrice),
    currentPrice: clamp01(args.currentPrice),
    costBasis: Math.max(0, Math.round(args.costBasis)),
    currentValue: Math.max(0, args.currentValue),
    potentialPayout: Math.max(0, Math.floor(netShares)),
    endAt: args.endAt,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Infer the direction colour bucket from a free-form entry label. Mirrors
 * what existing surfaces (PublicProfilePage, PredictionsPage) do — UP/DOWN
 * are explicit, everything else maps to "other" (multi-outcome candidate
 * picks on Race etc.).
 */
export function inferDirection(
  label: string | null | undefined,
): "up" | "down" | "other" {
  if (!label) return "other";
  const l = label.toLowerCase();
  if (l === "up" || l === "yes") return "up";
  if (l === "down" || l === "no") return "down";
  return "other";
}

/**
 * Single source of truth for the AMM buy / sell success toast (with
 * embedded Share action) shared across every surface that fires an
 * AMM trade: detail pages, predict carousel, home leaderboard, and
 * the PersonDetail predict tab.
 *
 * The helper builds the trade share-card data, constructs the toast
 * with a Share action, and dispatches to the global ShareCard context
 * via the `openShareCard` callback the caller passes in. Sell flows
 * are supported but currently only fired from UpDown / H2H detail
 * pages — community + race AMM sells don't have UI yet.
 */
export interface FireAmmTradeToastArgs {
  /** AMM trade response from the API. */
  response: {
    betId?: string;
    sharesPurchased?: number;
    sharesSold?: number;
    chargeCredits?: number;
    proceeds?: number;
    pricePerShareAvg?: number;
  };
  actionType: "buy" | "sell";
  /** Username to attribute the share to. Pass "you" if unknown. */
  username: string;
  personName: string | null;
  personAvatar: string | null;
  marketTitle: string;
  category?: string | null;
  /** Display label of the entry traded ("UP", "DOWN", candidate name). */
  entryLabel: string;
  direction: "up" | "down" | "other";
  /** Callback from `useShareCard()`. */
  openShareCard: (args: {
    data: ShareCardData;
    fallbackText?: string;
    shareUrl?: string;
    filenameBase?: string;
  }) => void;
  /**
   * Fallback URL when `response.betId` is missing (defensive — every
   * AMM trade has a betId, but pari rows during the legacy window may
   * not). Typically `${origin}${pathname}` or the market URL.
   */
  fallbackShareUrl: string;
  /**
   * Sharer's profile id. Threaded into the /share/bet/:betId
   * permalink as ?sharer= so the click-tracking endpoint can credit
   * the sharer for confirmed external clicks. Anonymous flows pass
   * undefined and the URL stays attribution-free.
   */
  sharerUserId?: string | null;
}

/**
 * Fires the AMM trade success toast with an embedded Share action.
 * Returns nothing — fire-and-forget. All non-jackpot markets run on AMM
 * post-parimutuel-sunset, so callers can fire this unconditionally.
 */
export function fireAmmTradeToast(args: FireAmmTradeToastArgs): void {
  const isBuy = args.actionType === "buy";
  const shares = Number(
    isBuy ? args.response.sharesPurchased : args.response.sharesSold,
  ) || 0;
  const credits = Number(
    isBuy ? args.response.chargeCredits : args.response.proceeds,
  ) || 0;
  const pricePerShare = (() => {
    const fromApi = Number(args.response.pricePerShareAvg);
    if (Number.isFinite(fromApi) && fromApi > 0) return fromApi;
    if (shares > 0 && credits > 0) return credits / shares;
    return 0;
  })();

  const tradeData = buildTradeShareData({
    actionType: args.actionType,
    username: args.username,
    personName: args.personName,
    personAvatar: args.personAvatar,
    marketTitle: args.marketTitle,
    category: args.category ?? null,
    entryLabel: args.entryLabel,
    direction: args.direction,
    shares,
    pricePerShare,
    stakeAmount: credits,
  });

  const betId = args.response.betId;
  const rawShareUrl = betId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/bet/${betId}`
    : args.fallbackShareUrl;
  // Attribution-stamp the URL so a confirmed external click can be
  // credited back to the sharer. We import lazily to avoid a tight
  // coupling between share-data (used in many call sites) and the
  // attribution helper.
  const shareUrl = appendShareAttribution(rawShareUrl, {
    sharerUserId: args.sharerUserId ?? null,
    surface: args.actionType === "buy" ? "prediction_win" : "portfolio",
  });

  const description = isBuy
    ? `${Math.round(shares).toLocaleString()} ${args.entryLabel} shares · ${formatVox(credits)}`
    : `Sold ${Math.round(shares).toLocaleString()} ${args.entryLabel} shares · +${formatVox(credits)}`;

  const fallbackText = isBuy
    ? `I just backed ${args.entryLabel} on "${args.marketTitle}" on VoxDex!\n${shareUrl}`
    : `Just took ${voxWord(credits)} off the table on "${args.marketTitle}" on VoxDex!\n${shareUrl}`;

  const title = isBuy ? "Prediction placed!" : "Position sold";

  toast(title, {
    description,
    // 6s instead of Sonner's 4s default so the Share action stays
    // clickable on mobile — testers reported the previous 4s window
    // disappeared before they could even register the toast, let alone
    // tap "Share". The persistent share icon on MyPositionCard is the
    // durable fallback; this just gives the in-moment shortcut a
    // realistic interaction budget without becoming intrusive.
    duration: 6000,
    action: {
      label: "Share",
      onClick: () =>
        args.openShareCard({
          data: tradeData,
          fallbackText,
          shareUrl,
          filenameBase: `voxdex-trade-${(betId ?? args.actionType).toString().slice(0, 8)}`,
        }),
    },
  });
}
