import type {
  ShareCardTradeData,
  ShareCardPositionData,
} from "@/components/share/ShareCard";

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
   * Buy: `chargeCredits` (credits debited).
   * Sell: `payoutAmount` or `proceeds` (credits credited).
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
    // Only meaningful for buys — share = 1 cr at settlement, so the floor
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
