import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendChart } from "@/components/TrendChart";
import { PersonAvatar } from "@/components/PersonAvatar";
import type { TrendingPerson } from "@shared/schema";
import { InsightsPill, InsightsSection } from "./insights-ui";
import { GitCompare } from "lucide-react";

type CompareMetric = "fameIndex" | "wikiPageviews" | "newsCount" | "velocityScore" | "massScore";

const METRIC_LABELS: Record<CompareMetric, string> = {
  fameIndex: "Fame Index",
  wikiPageviews: "Wikipedia pageviews",
  newsCount: "News (24h)",
  velocityScore: "Velocity score",
  massScore: "Mass score",
};

const METRICS: CompareMetric[] = [
  "fameIndex",
  "wikiPageviews",
  "newsCount",
  "velocityScore",
  "massScore",
];

export function CompareTab() {
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [metric, setMetric] = useState<CompareMetric>("fameIndex");

  const { data: people = [], isLoading } = useQuery<TrendingPerson[]>({
    queryKey: ["/api/trending", "compare-pick"],
    queryFn: async () => {
      const res = await fetch("/api/trending?sort=rank&limit=100");
      const json = await res.json();
      return Array.isArray(json) ? json : json.data ?? [];
    },
    staleTime: 120_000,
  });

  const primary = people.find((p) => p.id === primaryId) ?? people[0];

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading people…</p>;
  }
  if (!primary) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No people on the board yet.</p>;
  }

  return (
    <div className="space-y-6">
      <InsightsSection
        title="Compare signals"
        description="Overlay up to 5 people on one chart. Pick a primary person, then add others from the chart's compare control."
        accent="voxdex"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
          <GitCompare className="h-4 w-4 shrink-0" />
          Y-axis: <span className="font-medium text-foreground">{METRIC_LABELS[metric]}</span>
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-4">
          {METRICS.map((m) => (
            <InsightsPill key={m} active={metric === m} onClick={() => setMetric(m)}>
              {METRIC_LABELS[m]}
            </InsightsPill>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-4 border-b border-border/30">
          {people.slice(0, 40).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPrimaryId(p.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs shrink-0 transition-colors ${
                primary.id === p.id
                  ? "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                  : "border-border/40 hover:bg-muted/50"
              }`}
            >
              <PersonAvatar name={p.name} avatar={p.avatar} size="xs" />
              <span className="max-w-[72px] truncate">{p.name.split(" ")[0]}</span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border/40 bg-background/30 p-2 md:p-4 -mx-2 md:mx-0">
          <TrendChart
            personId={primary.id}
            personName={primary.name}
            seriesKey={metric}
          />
        </div>
      </InsightsSection>
    </div>
  );
}
