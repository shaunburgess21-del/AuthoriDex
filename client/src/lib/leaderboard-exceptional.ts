import type { LucideIcon } from "lucide-react";
import { Rocket, Flame, TrendingDown } from "lucide-react";

export interface PercentileThresholds {
  rankChangeP90: number;
  deltaP90: number;
  negRankChangeP10: number;
  negDeltaP10: number;
}

/** Minimal shape for momentum / exceptional badge logic */
export interface PersonWithMomentum {
  change24h?: number | null;
  rankChange?: number | null;
}

export function computePercentileThresholds(people: PersonWithMomentum[]): PercentileThresholds {
  const rankChanges = people.filter((p) => p.rankChange != null).map((p) => p.rankChange!);
  const deltas = people.filter((p) => p.change24h != null).map((p) => p.change24h!);

  const positiveRC = rankChanges.filter((v) => v > 0).sort((a, b) => b - a);
  const positiveDeltas = deltas.filter((v) => v > 0).sort((a, b) => b - a);
  const negativeRC = rankChanges.filter((v) => v < 0).sort((a, b) => a - b);
  const negativeDeltas = deltas.filter((v) => v < 0).sort((a, b) => a - b);

  const p5Index = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.05) - 1);
  const p10Index = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.1) - 1);

  return {
    rankChangeP90: positiveRC.length > 0 ? positiveRC[p5Index(positiveRC)] : 999,
    deltaP90: positiveDeltas.length > 0 ? positiveDeltas[p5Index(positiveDeltas)] : 999,
    negRankChangeP10: negativeRC.length > 0 ? negativeRC[p10Index(negativeRC)] : -999,
    negDeltaP10: negativeDeltas.length > 0 ? negativeDeltas[p10Index(negativeDeltas)] : -999,
  };
}

export function getExceptionalIndicator(
  person: PersonWithMomentum,
  thresholds?: PercentileThresholds
): {
  icon: LucideIcon;
  color: string;
  label: string;
  description: string;
  triggersHotMover: boolean;
} | null {
  const delta = person.change24h;
  const rankChange = person.rankChange;

  if (!thresholds) return null;

  const fmtDelta = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
  const fmtRank = (v: number) => `${v > 0 ? "+" : ""}${v}`;

  const metrics = `24h: ${delta != null ? fmtDelta(delta) : "—"} · Rank: ${rankChange != null ? fmtRank(rankChange) : "—"}`;

  if (rankChange != null && rankChange >= thresholds.rankChangeP90 && delta != null && delta >= thresholds.deltaP90) {
    return {
      icon: Rocket,
      color: "text-orange-400",
      label: "Breakout",
      description: `Big surge + big rank jump\n${metrics}`,
      triggersHotMover: true,
    };
  }
  if (delta != null && delta >= thresholds.deltaP90) {
    return {
      icon: Flame,
      color: "text-yellow-400",
      label: "Surging",
      description: `Driver: Score spike\n${metrics}`,
      triggersHotMover: true,
    };
  }
  if (rankChange != null && rankChange >= thresholds.rankChangeP90) {
    return {
      icon: Flame,
      color: "text-yellow-400",
      label: "Surging",
      description: `Driver: Rank jump\n${metrics}`,
      triggersHotMover: true,
    };
  }
  if (delta != null && delta <= thresholds.negDeltaP10 && delta <= -3) {
    const hasRankDrop = rankChange != null && rankChange <= thresholds.negRankChangeP10;
    return {
      icon: TrendingDown,
      color: "text-sky-300",
      label: "Cooling",
      description: `${hasRankDrop ? "Fading momentum + rank drop" : "Fading momentum"}\n${metrics}`,
      triggersHotMover: false,
    };
  }

  return null;
}
