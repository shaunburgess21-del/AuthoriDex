/**
 * All-time agent P&L for the admin V2 Agents tab.
 * Mirrors GET /api/leaderboard/users (period=all) accounting:
 * jackpot realised + AMM sell/resolution realised + unrealised MTM.
 */
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { marketBets } from "@shared/schema";
import { loadAmmAggregatePnlPerUser } from "./amm-positions";

export interface AdminAgentPnlRow {
  id: string;
  username: string;
  isActive: boolean;
  profitLoss: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalBets: number;
  volume: number;
}

type AgentPnlInput = {
  id: string;
  userId: string;
  username: string;
  isActive: boolean;
};

export async function buildAdminAgentPnlRows(
  agents: AgentPnlInput[],
): Promise<AdminAgentPnlRow[]> {
  if (agents.length === 0) return [];

  const agentUserIds = agents.map((a) => a.userId);
  const agentIds = agents.map((a) => a.id);

  const jackpotStatsRows = await db
    .select({
      userId: marketBets.userId,
      jackpotPnl: sql<number>`
        SUM(CASE
          WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} = 'won'
            THEN COALESCE(${marketBets.payoutAmount}, ${marketBets.potentialPayout}, 0) - ${marketBets.stakeAmount}
          WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} = 'lost'
            THEN -${marketBets.stakeAmount}
          ELSE 0
        END)`.as("jackpot_pnl"),
      jackpotVolume: sql<number>`SUM(CASE
        WHEN ${marketBets.actionType} = 'parimutuel' AND ${marketBets.status} IN ('won','lost')
          THEN ${marketBets.stakeAmount}
        ELSE 0
      END)`.as("jackpot_volume"),
    })
    .from(marketBets)
    .where(
      and(
        inArray(marketBets.userId, agentUserIds),
        inArray(marketBets.status, ["won", "lost", "settled"]),
      ),
    )
    .groupBy(marketBets.userId);

  const jackpotByUser = new Map(
    jackpotStatsRows.map((r) => [r.userId, r]),
  );

  const ammByUser = await loadAmmAggregatePnlPerUser({ userIds: agentUserIds });

  const betCountRows = await db
    .select({
      agentId: marketBets.agentId,
      totalBets: sql<number>`count(*)::int`.as("total_bets"),
    })
    .from(marketBets)
    .where(
      and(isNotNull(marketBets.agentId), inArray(marketBets.agentId, agentIds)),
    )
    .groupBy(marketBets.agentId);

  const betsByAgent = new Map(
    betCountRows.map((r) => [r.agentId!, r.totalBets]),
  );

  return agents
    .map((agent) => {
      const jackpot = jackpotByUser.get(agent.userId);
      const amm = ammByUser.get(agent.userId);
      const jackpotPnl = Number(jackpot?.jackpotPnl) || 0;
      const jackpotVolume = Number(jackpot?.jackpotVolume) || 0;
      const realisedPnl =
        jackpotPnl +
        (amm?.realisedFromSells ?? 0) +
        (amm?.realisedFromResolution ?? 0);
      const unrealisedPnl = amm?.unrealised ?? 0;
      return {
        id: agent.id,
        username: agent.username,
        isActive: agent.isActive,
        profitLoss: Math.round(realisedPnl + unrealisedPnl),
        realisedPnl: Math.round(realisedPnl),
        unrealisedPnl: Math.round(unrealisedPnl),
        totalBets: betsByAgent.get(agent.id) ?? 0,
        volume: Math.round(jackpotVolume + (amm?.turnover ?? 0)),
      };
    })
    .sort((a, b) => b.profitLoss - a.profitLoss);
}
