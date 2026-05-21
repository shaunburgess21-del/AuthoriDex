import { pricesFor, snapshotFromApi, type ApiAmmStateBlock } from "@/lib/ammClient";
import { smartName } from "@/components/predict/HeadToHeadCard";

export type CarouselSplitBarTone = "up" | "down" | "blue" | "purple";

export type CarouselSplitBar = {
  segments: Array<{ label: string; percent: number; tone: CarouselSplitBarTone }>;
};

function resolveUpDownPercents(m: {
  entries?: Array<{ id?: string; label?: string; totalStake?: number }>;
  ammState?: ApiAmmStateBlock | null;
}): { up: number; down: number } {
  const entries = m.entries ?? [];
  const upEntry = entries.find((e) => e.label?.toLowerCase() === "up");
  const downEntry = entries.find((e) => e.label?.toLowerCase() === "down");

  if (m.ammState && upEntry?.id && downEntry?.id) {
    const snap = snapshotFromApi(m.ammState);
    const prices = snap ? pricesFor(snap) : null;
    if (prices) {
      const upPrice = Number(prices[upEntry.id] ?? 0);
      const downPrice = Number(prices[downEntry.id] ?? 0);
      const sum = upPrice + downPrice;
      if (sum > 0) {
        const up = Math.round((upPrice / sum) * 100);
        return { up, down: 100 - up };
      }
    }
  }

  const upStake = Number(upEntry?.totalStake ?? 0);
  const downStake = Number(downEntry?.totalStake ?? 0);
  const total = upStake + downStake || 1;
  const up = Math.round((upStake / total) * 100) || 50;
  return { up, down: 100 - up };
}

export function buildUpDownSplitBar(m: {
  entries?: Array<{ id?: string; label?: string; totalStake?: number }>;
  ammState?: ApiAmmStateBlock | null;
}): CarouselSplitBar {
  const { up, down } = resolveUpDownPercents(m);
  return {
    segments: [
      { label: "Up", percent: up, tone: "up" },
      { label: "Down", percent: down, tone: "down" },
    ],
  };
}

function resolveH2hPercents(m: {
  entries?: Array<{
    id?: string;
    label?: string;
    totalStake?: number;
    person?: { name?: string } | null;
  }>;
  ammState?: ApiAmmStateBlock | null;
}): { left: { label: string; percent: number }; right: { label: string; percent: number } } {
  const entries = m.entries ?? [];
  const e1 = entries[0] ?? {};
  const e2 = entries[1] ?? {};
  const leftLabel = smartName(e1.person?.name || e1.label || "?");
  const rightLabel = smartName(e2.person?.name || e2.label || "?");

  if (m.ammState && e1.id && e2.id) {
    const snap = snapshotFromApi(m.ammState);
    const prices = snap ? pricesFor(snap) : null;
    if (prices) {
      const p1 = Number(prices[e1.id] ?? 0);
      const p2 = Number(prices[e2.id] ?? 0);
      const total = p1 + p2;
      if (total > 0) {
        const leftPct = Math.round((p1 / total) * 100);
        return {
          left: { label: leftLabel, percent: leftPct },
          right: { label: rightLabel, percent: 100 - leftPct },
        };
      }
    }
  }

  const s1 = Number(e1.totalStake ?? 0);
  const s2 = Number(e2.totalStake ?? 0);
  const total = s1 + s2 || 1;
  const leftPct = Math.round((s1 / total) * 100) || 50;
  return {
    left: { label: leftLabel, percent: leftPct },
    right: { label: rightLabel, percent: 100 - leftPct },
  };
}

export function buildH2hSplitBar(m: {
  entries?: Array<{
    id?: string;
    label?: string;
    totalStake?: number;
    person?: { name?: string } | null;
  }>;
  ammState?: ApiAmmStateBlock | null;
}): CarouselSplitBar {
  const { left, right } = resolveH2hPercents(m);
  return {
    segments: [
      { label: left.label, percent: left.percent, tone: "blue" },
      { label: right.label, percent: right.percent, tone: "purple" },
    ],
  };
}
