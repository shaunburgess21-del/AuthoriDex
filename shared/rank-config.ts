/**
 * Shared rank configuration — single source of truth for both server
 * and client. Imported by:
 *
 *   - server/scripts/seed-gamification.ts (writes the ranks table)
 *   - server/services/gamification-utils.ts (capability matrix)
 *   - client/src/lib/gamification-content.ts (re-exports for back-compat)
 *   - client/src/pages/HowItWorksPage.tsx (Ranks tab + RankLadderStrip)
 *   - client/src/components/RankUpModal.tsx (rank-up celebration)
 *
 * Threshold tweaks land in this file ONLY — the streak overhaul moved
 * streak constants to shared/streak-config.ts for the same reason.
 *
 * NOTE: voteMultiplier values are persisted on the ranks table for
 * roadmap reasons but are NOT currently consumed by any vote handler.
 * The server-side getVoteMultiplier() helper is annotated @deprecated;
 * we keep the column populated so re-introducing weighted voting is a
 * one-call-site change rather than a migration.
 */

export interface RankConfig {
  name: string;
  tier: number;
  minXp: number;
  /** null = open-ended top tier. */
  maxXp: number | null;
  voteMultiplier: number;
  /** Hex string used by RankBadge / RankLadderStrip / RankUpModal. */
  color: string;
  /** Lucide icon name (string), resolved client-side. */
  icon: string;
  description: string;
}

/**
 * The eight-tier ladder. Order MUST be ascending by tier — every
 * consumer assumes that and several do binary-search-style "next
 * milestone" lookups.
 *
 * Threshold rebalance (2026-05): shifted curve upward to make every
 * tier feel earned. Citizen now extends to 999 XP (was 499) so first-
 * day users don't auto-promote on a single session, and the top
 * tiers stretch to 400k for VoxMax Legend (was 150k) so the summit
 * stays rare even as the platform grows.
 */
export const RANKS: readonly RankConfig[] = [
  {
    name: "Citizen",
    tier: 1,
    minXp: 0,
    maxXp: 999,
    voteMultiplier: 1.0,
    color: "#6B7280",
    icon: "user",
    description:
      "Welcome to VoxDex. Every vote you cast and every prediction you make shapes the public sentiment we're indexing.",
  },
  {
    name: "Aspirant",
    tier: 2,
    minXp: 1000,
    maxXp: 4999,
    voteMultiplier: 1.0,
    color: "#10B981",
    icon: "trending-up",
    description:
      "You've found your rhythm. Your earn rate is starting to climb as you keep showing up.",
  },
  {
    name: "Insider",
    tier: 3,
    minXp: 5000,
    maxXp: 14999,
    voteMultiplier: 1.25,
    color: "#3B82F6",
    icon: "eye",
    description:
      "Your voice now carries curatorial weight. Your votes on who joins VoxDex and how they're represented count for more, and your rank shows on your takes.",
  },
  {
    name: "Analyst",
    tier: 4,
    minXp: 15000,
    maxXp: 34999,
    voteMultiplier: 1.5,
    color: "#8B5CF6",
    icon: "bar-chart",
    description:
      "A credible voice. Your earn rate is up, your curatorial influence grows, and your perspective helps shape what gets added.",
  },
  {
    name: "Expert",
    tier: 5,
    minXp: 35000,
    maxXp: 74999,
    voteMultiplier: 1.75,
    color: "#F59E0B",
    icon: "award",
    description:
      "Recognised as a serious participant. Your status is publicly visible, your contributions earn faster, and your curatorial influence is meaningful.",
  },
  {
    name: "Maven",
    tier: 6,
    minXp: 75000,
    maxXp: 149999,
    voteMultiplier: 2.0,
    color: "#EF4444",
    icon: "star",
    description:
      "Elite contributor. Your profile carries a custom banner, your comments stand out, and your curation shapes the index in real ways.",
  },
  {
    name: "Hall of Famer",
    tier: 7,
    minXp: 150000,
    maxXp: 399999,
    voteMultiplier: 2.5,
    color: "#FFD700",
    icon: "crown",
    description:
      "Legendary status. You're part of VoxDex's identity now, with permanent recognition on your profile.",
  },
  {
    name: "VoxMax Legend",
    tier: 8,
    minXp: 400000,
    maxXp: null,
    voteMultiplier: 3.0,
    color: "#E5E4E2",
    icon: "sparkles",
    description:
      "The rarest tier on VoxDex. A custom themed profile, top-tier earning, and maximum curatorial weight. You don't just participate — you set the pace.",
  },
] as const;

/**
 * Canonical capability identifiers. These are the strings written to
 * the route gates, the client `useUserStats().capabilities` map, and
 * the GET /api/gamification/check-permission/:capability endpoint.
 *
 * Ordering of the union mirrors the tier at which the capability is
 * unlocked, which makes the matrix easier to scan when grepping.
 */
export type Capability =
  // Every capability is open to every authenticated user. Rank no
  // longer gates engagement — higher tiers AMPLIFY participation (earn
  // rate, curatorial vote weight, status markers) rather than unlocking
  // actions. The dead tier-gated capabilities (can_suggest_*,
  // can_access_*, can_feature_insights, can_flag_content,
  // can_voxmax_profile) were removed in the rank redesign; voting,
  // posting, and commenting are all Tier-1 baseline now.
  | "can_vote_sentiment"
  | "can_vote_matchup"
  | "can_predict"
  | "can_vote_induction"
  | "can_vote_curation"
  | "can_post_insight"
  | "can_comment";

/**
 * Tier-1 baseline capabilities — open to every authenticated user.
 * Listed explicitly so getUserStats() can build a complete
 * `Record<Capability, boolean>` without having to remember which
 * caps are ungated.
 */
export const TIER_1_CAPABILITIES = [
  "can_vote_sentiment",
  "can_vote_matchup",
  "can_predict",
  "can_vote_induction",
  "can_vote_curation",
  // Ungated in the rank redesign — every Citizen can post insights and
  // comment anywhere from day one. Kept in the capability map (as
  // always-true) rather than deleted so existing client reads of
  // `capabilities.can_post_insight` / `.can_comment` keep working.
  "can_post_insight",
  "can_comment",
] as const satisfies readonly Capability[];

export interface CapabilityGate {
  capability: Capability;
  /** Tier at which the capability becomes available. */
  minTier: number;
  /** Short human label for the Ranks tab table. */
  label: string;
  /** One-sentence explanation for the Ranks tab and modal copy. */
  description: string;
}

/**
 * Capability → minimum tier matrix. The ONLY place where the
 * (capability, tier) pairing lives. Server enforcement reads this
 * via gamification-utils.ts; the Ranks tab UI iterates it directly.
 *
 * Tier 1 capabilities are intentionally omitted — they're available
 * to every authenticated user and don't need a row on the Ranks tab
 * (they'd show as "Tier 1+" with no gating signal).
 */
export const CAPABILITY_GATES: readonly CapabilityGate[] = [
  // Intentionally empty. The rank redesign moved VoxDex from
  // "rank unlocks features" to "rank amplifies participation": every
  // engagement action (voting, posting insights, commenting,
  // suggesting, reporting) is available to every authenticated user.
  //
  // What rank now changes — earn-rate multiplier, curatorial vote
  // weight on Induction/Curate, an inline comment qualifier, and
  // profile visual unlocks — is NOT capability gating and is not
  // represented here. The Ranks tab renders those rewards directly
  // from the RANKS ladder, not from this array.
] as const;

/**
 * Pure helper — resolve the rank a given XP total falls into. Used
 * by the server's awardXp() promotion path AND by the client when
 * the live ranks API is unavailable. Mirrors
 * server/services/gamification-ranks.ts but operates on the canonical
 * RankConfig shape so callers don't need a parallel type.
 */
export function resolveRankForXp(xp: number): RankConfig | null {
  for (const rank of RANKS) {
    if (xp >= rank.minXp && (rank.maxXp === null || xp <= rank.maxXp)) {
      return rank;
    }
  }
  return null;
}

/**
 * Look up a rank row by name. Returns null when the input is unknown
 * (e.g. a stale `profiles.rank` value that pre-dates a rebalance).
 * Callers should fall back to the Citizen entry in that case rather
 * than rendering nothing.
 */
export function getRankByName(name: string | null | undefined): RankConfig | null {
  if (!name) return null;
  return RANKS.find((r) => r.name === name) ?? null;
}

/**
 * Capability → minTier lookup, derived once at module-load time. This
 * is what server-side gates and the client capability map consume.
 * Capabilities not listed here default to tier 1 (open to everyone).
 */
export const CAPABILITY_MIN_TIER: Readonly<Partial<Record<Capability, number>>> =
  Object.freeze(
    CAPABILITY_GATES.reduce<Partial<Record<Capability, number>>>((acc, gate) => {
      acc[gate.capability] = gate.minTier;
      return acc;
    }, {}),
  );

/**
 * Capabilities introduced at exactly the given tier. Used by the
 * RankUpModal "Now unlocked" section so a promotion to tier N only
 * surfaces the things that became available at N (and not the
 * things the user already had at N-1).
 */
export function capabilitiesUnlockedAtTier(tier: number): readonly CapabilityGate[] {
  return CAPABILITY_GATES.filter((g) => g.minTier === tier);
}

/**
 * Every capability the system knows about, in a stable order.
 * Server-side getUserStats() builds the per-user capability boolean
 * map from this list so adding a new capability to CAPABILITY_GATES
 * automatically propagates to the API response without a manual edit.
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  ...TIER_1_CAPABILITIES,
  ...CAPABILITY_GATES.map((g) => g.capability),
] as const;
