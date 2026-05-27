import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightsSection, InsightsEmptyState } from "./insights-ui";
import { BarChart3 } from "lucide-react";

export function MarketsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/open-markets", "insights"],
    queryFn: async () => {
      const res = await fetch("/api/open-markets?limit=12");
      if (!res.ok) return [];
      const json = await res.json();
      return json.data ?? json.markets ?? [];
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-border/40 bg-muted/20 p-4">
        <BarChart3 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Full market analytics — open interest, contested lines, implied vs actual — are coming in a
            later phase. Below are active markets you can explore now.
          </p>
          <Badge variant="secondary" className="mt-2 text-[10px]">
            Phase 3
          </Badge>
        </div>
      </div>

      <InsightsSection title="Active markets" description="Open prediction markets with the most activity.">
        {isLoading && (
          <div className="grid sm:grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {!isLoading && (data ?? []).length === 0 && (
          <InsightsEmptyState message="No open markets right now." />
        )}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data ?? []).slice(0, 12).map(
            (m: { id: string; slug?: string; title?: string; marketType?: string }) => (
              <li key={m.id}>
                <Link
                  href={m.slug ? `/markets/${m.slug}` : "/predict"}
                  className="block p-4 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 hover:border-border/60 transition-colors h-full"
                >
                  <p className="font-medium text-sm line-clamp-2">{m.title ?? "Market"}</p>
                  {m.marketType && (
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mt-2">
                      {m.marketType}
                    </p>
                  )}
                </Link>
              </li>
            ),
          )}
        </ul>
      </InsightsSection>
    </div>
  );
}
