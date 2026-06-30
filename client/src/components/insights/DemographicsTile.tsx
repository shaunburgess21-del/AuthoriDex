import { useState, type ReactNode } from "react";
import { Globe2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DoughnutChart } from "@/components/charts/DoughnutChart";
import { CountryFlag } from "@/components/ui/CountryFlag";
import { useInsightsQuery } from "@/lib/insights-hooks";
import { InsightsEmptyState } from "./insights-ui";
import { cn } from "@/lib/utils";
import { getCountryName } from "@shared/countries";

export type DemographicWindow = "all" | "30d" | "7d";

export type DemographicMetricKey = "primary" | "secondary" | "tertiary";

export interface DemographicChartRow {
  key: string;
  label: string;
  primary: number;
  secondary: number;
  tertiary: number;
}

export interface DemographicChartData {
  participantCount: number;
  countryCount: number;
  totalPrimary: number;
  totalSecondary: number;
  totalTertiary: number;
  byCountry: DemographicChartRow[];
  byGender: DemographicChartRow[];
}

export const DEMOGRAPHIC_GENDER_COLORS: Record<string, string> = {
  male: "#3B82F6",
  female: "#A78BFA",
  prefer_not_to_say: "#94A3B8",
};

function genderColorForKey(key: string): string | undefined {
  const normalized =
    key === "man" || key === "m"
      ? "male"
      : key === "woman" || key === "f"
        ? "female"
        : key;
  return DEMOGRAPHIC_GENDER_COLORS[normalized];
}

export function DemographicsWindowToggle({
  value,
  onChange,
}: {
  value: DemographicWindow;
  onChange: (next: DemographicWindow) => void;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[11px] font-medium"
      role="group"
      aria-label="Demographics time window"
    >
      {(
        [
          ["all", "All time"],
          ["30d", "30d"],
          ["7d", "7d"],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-2.5 py-1.5 transition-colors sm:px-3",
            value === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export interface DemographicMetricOption {
  key: DemographicMetricKey;
  label: string;
  centerSubtitle: string;
}

export interface DemographicsTileProps {
  apiPath: string;
  emptyMessage: string;
  metrics: readonly [DemographicMetricOption, DemographicMetricOption, DemographicMetricOption];
  formatMetricValue: (value: number, metric: DemographicMetricKey) => string;
  renderSummaryStats: (data: DemographicChartData) => ReactNode;
  barGradientClass: string;
  isEmpty: (data: DemographicChartData) => boolean;
  mapData: (raw: unknown) => DemographicChartData;
  /** When true, parent supplies data/loading via externalData + externalLoading. */
  managedExternally?: boolean;
  externalData?: unknown;
  externalLoading?: boolean;
  noBreakdownMessage?: string;
}

function metricValue(row: DemographicChartRow, metric: DemographicMetricKey): number {
  if (metric === "secondary") return row.secondary;
  if (metric === "tertiary") return row.tertiary;
  return row.primary;
}

function totalForMetric(data: DemographicChartData, metric: DemographicMetricKey): number {
  if (metric === "secondary") return data.totalSecondary;
  if (metric === "tertiary") return data.totalTertiary;
  return data.totalPrimary;
}

export function DemographicsTile({
  apiPath,
  emptyMessage,
  metrics,
  formatMetricValue,
  renderSummaryStats,
  barGradientClass,
  isEmpty,
  mapData,
  managedExternally = false,
  externalData,
  externalLoading = false,
  noBreakdownMessage = "No demographic breakdown available yet.",
}: DemographicsTileProps) {
  const internalQuery = useInsightsQuery<unknown>(apiPath, {
    queryKey: [apiPath],
    enabled: !managedExternally,
  });
  const [metric, setMetric] = useState<DemographicMetricKey>("primary");

  const isLoading = managedExternally ? externalLoading : internalQuery.isLoading;
  const raw = managedExternally ? externalData : internalQuery.data;

  if (isLoading) return <Skeleton className="h-56 w-full" />;

  const data = raw ? mapData(raw) : null;
  if (!data || isEmpty(data)) {
    return <InsightsEmptyState message={emptyMessage} />;
  }

  const hasBreakdown = data.byGender.length > 0 || data.byCountry.length > 0;

  const activeMetric = metrics.find((m) => m.key === metric) ?? metrics[0];
  const formatMetric = (value: number) => formatMetricValue(value, metric);

  const genderSegments = data.byGender.map((row) => ({
    id: row.key,
    label: row.label,
    value: metricValue(row, metric),
    color: genderColorForKey(row.key),
  }));

  const centerTitle = formatMetricValue(totalForMetric(data, metric), metric);
  const centerSubtitle = activeMetric.centerSubtitle;

  const topCountries = data.byCountry.slice(0, 8);
  const maxCountryMetric = Math.max(...topCountries.map((r) => metricValue(r, metric)), 1);

  const topGender = [...data.byGender].sort(
    (a, b) => metricValue(b, metric) - metricValue(a, metric),
  )[0];
  const topCountry = [...data.byCountry].sort(
    (a, b) => metricValue(b, metric) - metricValue(a, metric),
  )[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {renderSummaryStats(data)}
        <div
          className="inline-flex w-full sm:w-auto shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[10px] font-medium sm:text-[11px]"
          role="group"
          aria-label="Demographics metric"
        >
          {metrics.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
              className={cn(
                "flex-1 sm:flex-none rounded-md px-2 py-1.5 transition-colors sm:px-3",
                metric === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!hasBreakdown ? (
        <InsightsEmptyState message={noBreakdownMessage} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Gender split</p>
            <DoughnutChart
              data={genderSegments}
              centerTitle={centerTitle}
              centerSubtitle={centerSubtitle}
              height={200}
              innerRadiusRatio={0.62}
            />
            {topGender ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Largest group: {topGender.label} ({formatMetric(metricValue(topGender, metric))})
              </p>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3">Top countries</p>
            {topCountries.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center rounded-lg bg-muted/20 border border-dashed border-border/50">
                No country data yet.
              </p>
            ) : (
              <>
                <ul className="space-y-2.5">
                  {topCountries.map((row) => {
                    const value = metricValue(row, metric);
                    const pct = Math.round((value / maxCountryMetric) * 100);
                    const countryName = row.label || getCountryName(row.key) || row.key;
                    return (
                      <li key={row.key}>
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <CountryFlag code={row.key} title={countryName} />
                            <span className="font-medium truncate">{countryName}</span>
                          </span>
                          <span className="text-muted-foreground tabular-nums shrink-0">
                            {formatMetric(value)}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                          <div
                            className={cn("h-full rounded-full bg-gradient-to-r", barGradientClass)}
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {topCountry ? (
                  <p className="mt-2 text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                    <Globe2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">
                      Most active: {getCountryName(topCountry.key) ?? topCountry.key} (
                      {formatMetric(metricValue(topCountry, metric))})
                    </span>
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
