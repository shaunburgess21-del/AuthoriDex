import { Link, useLocation } from "wouter";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { InsightsOverviewResponse, InsightsQuadrantPoint } from "@shared/insights/types";
import { ChartOrList } from "./ChartOrList";
import { PersonAvatar } from "@/components/PersonAvatar";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { InsightsSection } from "./insights-ui";

const QUADRANT_LABELS: Record<InsightsQuadrantPoint["quadrant"], string> = {
  beloved_giants: "Beloved Giants",
  hated_giants: "Polarising Giants",
  cult_favourites: "Cult Favourites",
  unknown_critics: "Unknown Critics",
};

const QUADRANT_COLORS: Record<InsightsQuadrantPoint["quadrant"], string> = {
  beloved_giants: "hsl(142 71% 45%)",
  hated_giants: "hsl(0 84% 60%)",
  cult_favourites: "hsl(217 91% 60%)",
  unknown_critics: "hsl(271 81% 56%)",
};

function QuadrantTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: InsightsQuadrantPoint }>;
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{p.name}</p>
      <p className="text-muted-foreground mt-0.5">
        Trend Score {p.fameIndex.toLocaleString()} · Approval {Math.round(p.approvalPct)}%
      </p>
    </div>
  );
}

function QuadrantMobileLists({ points }: { points: InsightsQuadrantPoint[] }) {
  const groups = (Object.keys(QUADRANT_LABELS) as InsightsQuadrantPoint["quadrant"][]).map((q) => ({
    quadrant: q,
    items: points.filter((p) => p.quadrant === q).slice(0, 5),
  }));

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {groups.map(({ quadrant, items }) => (
        <details
          key={quadrant}
          className="rounded-lg border border-border/40 bg-background/40 p-3"
          open={items.length > 0}
        >
          <summary className="font-medium text-sm cursor-pointer list-none flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: QUADRANT_COLORS[quadrant] }}
            />
            {QUADRANT_LABELS[quadrant]}
            <span className="text-muted-foreground font-normal">({items.length})</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/person/${p.id}`} className="flex items-center gap-2 text-sm">
                  <PersonAvatar name={p.name} avatar={p.avatar} size="xs" />
                  <span className="truncate flex-1">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">TS {p.fameIndex.toLocaleString()}</span>
                </Link>
              </li>
            ))}
            {items.length === 0 && (
              <li className="text-xs text-muted-foreground">No names in this quadrant.</li>
            )}
          </ul>
        </details>
      ))}
    </div>
  );
}

export function QuadrantSection({
  points,
  meta,
}: {
  points: InsightsQuadrantPoint[];
  meta: InsightsOverviewResponse["quadrantMeta"];
}) {
  const [, setLocation] = useLocation();

  return (
    <InsightsSection
      tab="discover"
      title="Approval × Trend Score"
      description={`Where attention meets sentiment. ${meta.includedCount} people with ≥${meta.minVotes} votes; median split shown on desktop.`}
    >
      <ChartOrList
        chart={
          <div className="h-[300px] md:h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis
                  type="number"
                  dataKey="fameIndex"
                  name="Trend Score"
                  tick={{ fontSize: 11 }}
                  label={{ value: "Trend Score", position: "bottom", offset: 0, fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="approvalPct"
                  name="Approval"
                  tick={{ fontSize: 11 }}
                  domain={[0, 100]}
                  label={{
                    value: "Approval %",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 11,
                  }}
                />
                <ReferenceLine
                  x={meta.medianFame}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
                <ReferenceLine
                  y={meta.medianApproval}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  strokeOpacity={0.5}
                />
                <Tooltip content={<QuadrantTooltip />} />
                <Scatter
                  data={points}
                  onClick={(pt) => {
                    const p = pt as InsightsQuadrantPoint;
                    logInsightsEvent("discover", "quadrant_click", { personId: p.id });
                    setLocation(`/person/${p.id}`);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {points.map((p) => (
                    <Cell key={p.id} fill={QUADRANT_COLORS[p.quadrant]} fillOpacity={0.85} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        }
        list={<QuadrantMobileLists points={points} />}
      />
    </InsightsSection>
  );
}
