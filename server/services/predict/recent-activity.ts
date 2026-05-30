import { db } from "../../db";
import { marketBets, predictionMarkets, marketEntries, profiles } from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { memoizeAsync } from "../insights/request-memo";

/** Short TTL — feed is polled every 60–90s on /predict and Town Square. */
export const PREDICT_RECENT_ACTIVITY_MEMO_MS = 20_000;

export async function loadRecentPredictionActivity(limit: number): Promise<unknown[]> {
  const queryLimit = Math.max(1, Math.min(limit || 20, 100));
  const cacheKey = `predict:recent-activity:${queryLimit}`;

  return memoizeAsync(cacheKey, PREDICT_RECENT_ACTIVITY_MEMO_MS, async () => {
    const recentBets = await db
      .select({
        id: marketBets.id,
        marketId: marketBets.marketId,
        entryId: marketBets.entryId,
        userId: marketBets.userId,
        stakeAmount: marketBets.stakeAmount,
        actionType: marketBets.actionType,
        shareCount: marketBets.shareCount,
        pricePerShare: marketBets.pricePerShare,
        payoutAmount: marketBets.payoutAmount,
        confidence: marketBets.confidence,
        createdAt: marketBets.createdAt,
        betMetadata: marketBets.betMetadata,
      })
      .from(marketBets)
      .where(inArray(marketBets.status, ["active", "settled"]))
      .orderBy(desc(marketBets.createdAt))
      .limit(queryLimit);

    if (recentBets.length === 0) {
      return [];
    }

    const userIds = Array.from(new Set(recentBets.map((bet) => bet.userId)));
    const marketIds = Array.from(new Set(recentBets.map((bet) => bet.marketId)));
    const entryIds = Array.from(new Set(recentBets.map((bet) => bet.entryId)));

    const { getSimulationProfile, shouldShowPublicConfidence } = await import(
      "../../agents/simulationProfile"
    );
    const { agentConfigs: agentConfigsTable } = await import("@shared/schema");

    const [profileRows, marketRows, entryRows, agentRows] = await Promise.all([
      db
        .select({
          id: profiles.id,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
          isAgent: profiles.isAgent,
          isPublic: profiles.isPublic,
          positionsPublic: profiles.positionsPublic,
        })
        .from(profiles)
        .where(and(inArray(profiles.id, userIds), eq(profiles.isHouse, false))),
      db
        .select({
          id: predictionMarkets.id,
          title: predictionMarkets.title,
          slug: predictionMarkets.slug,
          marketType: predictionMarkets.marketType,
          status: predictionMarkets.status,
          visibility: predictionMarkets.visibility,
        })
        .from(predictionMarkets)
        .where(inArray(predictionMarkets.id, marketIds)),
      db
        .select({
          id: marketEntries.id,
          label: marketEntries.label,
        })
        .from(marketEntries)
        .where(inArray(marketEntries.id, entryIds)),
      db
        .select({
          userId: agentConfigsTable.userId,
          simulationProfile: agentConfigsTable.simulationProfile,
        })
        .from(agentConfigsTable)
        .where(inArray(agentConfigsTable.userId, userIds)),
    ]);

    const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
    const marketMap = new Map(marketRows.map((market) => [market.id, market]));
    const entryMap = new Map(entryRows.map((entry) => [entry.id, entry]));
    const agentSimulationMap = new Map(
      agentRows.map(
        (row) => [row.userId, getSimulationProfile(row.simulationProfile)] as const,
      ),
    );

    return recentBets
      .map((bet) => {
        const profile = profileMap.get(bet.userId);
        const market = marketMap.get(bet.marketId);
        const entry = entryMap.get(bet.entryId);

        if (!profile || !market || !entry) return null;
        if (market.status !== "OPEN") return null;
        if (!["live", "inactive"].includes(market.visibility || "")) return null;

        const rationale =
          bet.betMetadata &&
          typeof bet.betMetadata === "object" &&
          "rationale" in (bet.betMetadata as Record<string, unknown>)
            ? String((bet.betMetadata as Record<string, unknown>).rationale || "").trim()
            : null;

        const rawConfidence = bet.confidence ? Number(bet.confidence) : null;
        let displayConfidence: number | null = rawConfidence;
        if (profile?.isAgent) {
          const sim = agentSimulationMap.get(bet.userId);
          displayConfidence =
            sim && rawConfidence != null && shouldShowPublicConfidence(sim, `bet:${bet.id}`)
              ? rawConfidence
              : null;
        }

        const actionType = (bet.actionType ?? "parimutuel") as "parimutuel" | "buy" | "sell";

        const positionsHidden = profile?.positionsPublic === false;
        const profilePrivate = profile?.isPublic === false;
        const reveal = !positionsHidden && !profilePrivate;

        return {
          id: bet.id,
          createdAt: bet.createdAt,
          stakeAmount: bet.stakeAmount,
          actionType,
          shareCount: bet.shareCount != null ? Number(bet.shareCount) : null,
          pricePerShare: bet.pricePerShare != null ? Number(bet.pricePerShare) : null,
          payoutAmount: bet.payoutAmount ?? null,
          confidence: displayConfidence,
          choiceLabel: entry.label,
          marketId: market.id,
          marketTitle: market.title,
          marketSlug: market.slug,
          marketType: market.marketType,
          username: reveal ? profile?.username || null : null,
          displayName: reveal ? profile?.username || "Anonymous" : "Private Predictor",
          avatarUrl: reveal ? profile?.avatarUrl || null : null,
          isAgent: profile?.isAgent ?? false,
          isPublic: reveal,
          rationale: reveal ? rationale || null : null,
        };
      })
      .filter(Boolean);
  });
}
