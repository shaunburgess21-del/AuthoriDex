/**
 * Shared market/pick labeling for prediction notifications.
 *
 * Multi-candidate markets (gainer, multi, h2h) name the user's entry
 * pick; up/down markets name the market-level person when available.
 * `formatMarketLead` puts the pick before the market title when it
 * adds context (e.g. "Clavicular · Category Race: Streaming").
 */

export const PER_ENTRY_MARKET_TYPES = new Set(["gainer", "multi", "h2h"]);

export interface PickContextInput {
  marketType: string;
  candidateName: string | null;
  entryLabel: string;
  personName: string | null;
}

/**
 * Which name to show as the user's "pick" in notification copy.
 */
export function resolvePickContextLabel(input: PickContextInput): string | null {
  const { marketType, candidateName, entryLabel, personName } = input;
  if (PER_ENTRY_MARKET_TYPES.has(marketType)) {
    return candidateName ?? entryLabel ?? null;
  }
  return personName ?? entryLabel ?? null;
}

/** @deprecated Use resolvePickContextLabel — alias for position_move_alert imports. */
export const resolvePositionMoveContextLabel = resolvePickContextLabel;

/** Body/title lead: pick first when it adds context, else market title only. */
export function formatMarketLead(marketTitle: string, contextLabel?: string | null): string {
  const title = marketTitle.trim() || "Your market";
  const ctx = contextLabel?.trim();
  if (!ctx) return title;
  if (title.toLowerCase().includes(ctx.toLowerCase())) return title;
  return `${ctx} · ${title}`;
}
