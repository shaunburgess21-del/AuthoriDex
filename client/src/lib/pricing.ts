/**
 * Credit package catalogue surfaced on /pricing.
 *
 * USD-only by design — Paddle handles currency conversion at checkout based
 * on the buyer's billing country, so we don't show local-currency
 * approximations on our side. Prices are stored in dollars (not cents)
 * because the values display directly on cards.
 *
 * `perCreditUSD` and `savingsPct` are precomputed here so the comparison
 * table and per-credit copy stay in lock-step with the headline prices —
 * if you change `priceUSD` or `credits`, recompute these in the same edit.
 */
export type CreditPackageId = "starter" | "standard" | "pro" | "power";

export type CreditPackageBadge = "Most popular" | "Best value";

export interface CreditPackage {
  id: CreditPackageId;
  name: string;
  credits: number;
  priceUSD: number;
  /** USD per credit (price ÷ credits). e.g. 0.000833 → 0.083¢ display. */
  perCreditUSD: number;
  /** Percent savings vs Starter's per-credit rate; null on the base tier. */
  savingsPct: number | null;
  /** Visual emphasis label. Only one tier carries each badge. */
  badge: CreditPackageBadge | null;
  description: string;
}

export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 12_000,
    priceUSD: 9.99,
    perCreditUSD: 0.000833,
    savingsPct: null,
    badge: null,
    description: "Top up for another night of predicting.",
  },
  {
    id: "standard",
    name: "Standard",
    credits: 30_000,
    priceUSD: 19.99,
    perCreditUSD: 0.000666,
    savingsPct: 20,
    badge: "Most popular",
    description: "A couple weeks of casual play.",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 75_000,
    priceUSD: 39.99,
    perCreditUSD: 0.000533,
    savingsPct: 36,
    badge: null,
    description: "Serious predictor mode.",
  },
  {
    id: "power",
    name: "Power",
    credits: 200_000,
    priceUSD: 79.99,
    perCreditUSD: 0.000400,
    savingsPct: 52,
    badge: "Best value",
    description: "For the dedicated.",
  },
] as const;

/** First-purchase bonus percentage (display-only for v1).
 *
 * TODO: implement first-purchase bonus logic server-side. The pricing page
 * shows this number on a callout, but no purchase flow currently grants the
 * extra credits — that needs the real Paddle integration plus a one-shot
 * server check on the user's lifetime purchase count. */
export const FIRST_TIME_BONUS_PCT = 25;

/** Format USD as "$9.99". */
export function formatUSD(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** Format the per-credit rate as "0.083¢" (cents, three decimal places). */
export function formatPerCreditCents(perCreditUSD: number): string {
  const cents = perCreditUSD * 100;
  return `${cents.toFixed(3)}¢`;
}

/** Look up a package by id; returns undefined if unknown (e.g. a bad URL). */
export function getCreditPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === id);
}
