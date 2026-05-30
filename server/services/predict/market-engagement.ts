import { db } from "../../db";
import { marketBets, profiles } from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";

export interface MarketEngagementPreview {
  recentParticipantsByMarket: Map<
    string,
    Array<{
      userId: string;
      username: string | null;
      displayName: string;
      avatarUrl: string | null;
      isAgent: boolean;
    }>
  >;
  activeParticipantCountByMarket: Map<string, number>;
  latestRationaleByMarket: Map<
    string,
    {
      text: string;
      authorUsername: string | null;
      authorDisplayName: string;
      authorAvatarUrl: string | null;
      isAgent: boolean;
    }
  >;
}

/**
 * Batch "social proof" lookup for a set of markets: up to 3 recent unique
 * participants, the active participant count, and the latest agent rationale
 * per market. Shared by the open-markets and native-markets card feeds.
 * Self-contained (only db + schema), so it lives outside routes.ts to keep
 * the native-markets service free of a circular import.
 */
export async function getMarketEngagementPreview(
  marketIds: string[],
): Promise<MarketEngagementPreview> {
  const recentParticipantsByMarket: MarketEngagementPreview["recentParticipantsByMarket"] =
    new Map();
  const activeParticipantCountByMarket = new Map<string, number>();
  const latestRationaleByMarket: MarketEngagementPreview["latestRationaleByMarket"] =
    new Map();

  if (marketIds.length === 0) {
    return {
      recentParticipantsByMarket,
      activeParticipantCountByMarket,
      latestRationaleByMarket,
    };
  }

  const bets = await db
    .select({
      marketId: marketBets.marketId,
      userId: marketBets.userId,
      createdAt: marketBets.createdAt,
      betMetadata: marketBets.betMetadata,
    })
    .from(marketBets)
    .where(and(inArray(marketBets.marketId, marketIds), eq(marketBets.status, "active")))
    .orderBy(desc(marketBets.createdAt));

  if (bets.length === 0) {
    return {
      recentParticipantsByMarket,
      activeParticipantCountByMarket,
      latestRationaleByMarket,
    };
  }

  const userIds = Array.from(new Set(bets.map((bet) => bet.userId)));
  const profileRows =
    userIds.length > 0
      ? await db
          .select({
            id: profiles.id,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
            isAgent: profiles.isAgent,
          })
          .from(profiles)
          .where(
            and(
              inArray(profiles.id, userIds),
              // Defensive: exclude the AMM house sentinel from
              // participant avatar stacks. The house never inserts
              // into market_bets directly today, but Phase 3+ ledger
              // flows touch market_bets-adjacent paths and we want
              // user-facing UIs to never show __house__.
              eq(profiles.isHouse, false),
            ),
          )
      : [];

  const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
  const participantSets = new Map<string, Set<string>>();
  const countedParticipants = new Map<string, Set<string>>();

  for (const bet of bets) {
    const profile = profileMap.get(bet.userId);
    const displayName = profile?.username || "Anonymous";
    const username = profile?.username || null;
    const avatarUrl = profile?.avatarUrl || null;
    const isAgent = profile?.isAgent ?? false;

    const counted = countedParticipants.get(bet.marketId) || new Set<string>();
    counted.add(bet.userId);
    countedParticipants.set(bet.marketId, counted);
    activeParticipantCountByMarket.set(bet.marketId, counted.size);

    const seen = participantSets.get(bet.marketId) || new Set<string>();
    if (!seen.has(bet.userId)) {
      seen.add(bet.userId);
      participantSets.set(bet.marketId, seen);

      const participants = recentParticipantsByMarket.get(bet.marketId) || [];
      if (participants.length < 3) {
        participants.push({
          userId: bet.userId,
          username,
          displayName,
          avatarUrl,
          isAgent,
        });
        recentParticipantsByMarket.set(bet.marketId, participants);
      }
    }

    const rationaleText =
      bet.betMetadata &&
      typeof bet.betMetadata === "object" &&
      "rationale" in (bet.betMetadata as Record<string, unknown>)
        ? String((bet.betMetadata as Record<string, unknown>).rationale || "").trim()
        : "";

    if (isAgent && rationaleText && !latestRationaleByMarket.has(bet.marketId)) {
      latestRationaleByMarket.set(bet.marketId, {
        text: rationaleText,
        authorUsername: username,
        authorDisplayName: displayName,
        authorAvatarUrl: avatarUrl,
        isAgent,
      });
    }
  }

  return {
    recentParticipantsByMarket,
    activeParticipantCountByMarket,
    latestRationaleByMarket,
  };
}
