import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SourceHealth {
  state: "HEALTHY" | "DEGRADED" | "OUTAGE" | "RECOVERY";
  reason: string;
  staleMinutes: number | null;
  isHealthy: boolean;
}

interface SourceHealthResponse {
  hasDegradedSources: boolean;
  summary: string;
  sources: {
    news: SourceHealth;
    search: SourceHealth;
    wiki: SourceHealth;
  };
}

function formatStaleDuration(minutes: number | null): string {
  if (minutes === null) return "unknown";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function getSourceLabel(source: string): string {
  switch (source) {
    case "news": return "News";
    case "search": return "Search";
    case "wiki": return "Wikipedia";
    default: return source;
  }
}

export function SourceHealthBanner() {
  const { data: health } = useQuery<SourceHealthResponse>({
    queryKey: ["/api/source-health"],
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (!health?.hasDegradedSources) {
    return null;
  }

  const degradedSources = Object.entries(health.sources)
    .filter(([_, source]) => !source.isHealthy)
    .map(([name, source]) => ({
      name,
      label: getSourceLabel(name),
      state: source.state,
      staleMinutes: source.staleMinutes,
    }));

  if (degradedSources.length === 0) {
    return null;
  }

  const isRecovering = degradedSources.some(s => s.state === "RECOVERY");

  return (
    <Alert 
      data-testid="banner-source-health"
      className="mb-4 border-amber-500/50 bg-amber-500/10"
    >
      <div className="flex items-start gap-3">
        {isRecovering ? (
          <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        )}
        <AlertDescription className="text-sm text-amber-200">
          {isRecovering ? (
            <span>Data sources recovering. Rankings updating...</span>
          ) : (
            <span>
              Some data sources are temporarily delayed. Rankings may be less responsive.
            </span>
          )}
          <span className="ml-2 text-amber-400/70">
            ({degradedSources.map(s => 
              `${s.label}: ${s.state}${s.staleMinutes ? ` (${formatStaleDuration(s.staleMinutes)} stale)` : ""}`
            ).join(", ")})
          </span>
        </AlertDescription>
      </div>
    </Alert>
  );
}
