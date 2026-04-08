import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/PersonAvatar";
import { CategoryPill } from "@/components/CategoryPill";

interface ValueLeaderboardRow {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  fameIndex: number | null;
  leaderboardRank: number | null;
  underratedPct: number | null;
  overratedPct: number | null;
  fairlyRatedPct: number | null;
  totalVotes?: number | null;
}

interface ValueLeaderboardResponse {
  data: ValueLeaderboardRow[];
}

export default function ValueRankingsPage() {
  const [location] = useLocation();
  const focusId =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("focus")
      : null;

  const { data, isLoading } = useQuery<ValueLeaderboardResponse>({
    queryKey: ["/api/leaderboard?tab=value&limit=1000"],
    staleTime: 60 * 1000,
  });

  const rows = data?.data ?? [];
  const rowEls = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = rowEls.current[focusId];
    if (el) {
      requestAnimationFrame(() =>
        el.scrollIntoView({ block: "center", behavior: "smooth" })
      );
    }
  }, [focusId, isLoading, location, rows.length]);

  return (
    <div className="min-h-screen bg-background pb-24 md:pb-8">
      <div className="border-b bg-background/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="container mx-auto px-4 h-14 flex items-center gap-3 max-w-3xl">
          <Link href="/vote">
            <Button variant="ghost" size="icon" data-testid="button-back-value-rankings" aria-label="Back to Vote">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="font-serif font-bold text-lg md:text-xl truncate">
            Under / Over rated — full rankings
          </h1>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 max-w-3xl">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-600 dark:text-cyan-400" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No rankings loaded yet.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((person) => {
              const rank = person.leaderboardRank ?? "—";
              const isFocus = focusId === person.id;
              const u = person.underratedPct ?? 0;
              const o = person.overratedPct ?? 0;
              const f = person.fairlyRatedPct ?? 0;
              return (
                <div
                  key={person.id}
                  ref={(el) => {
                    rowEls.current[person.id] = el;
                  }}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    isFocus
                      ? "border-[#EFEFEF]/50 bg-white/[0.06] shadow-[0_8px_28px_rgba(239,239,239,0.1)]"
                      : "border-border/40 bg-card/40 hover:border-border/60"
                  }`}
                  data-testid={`value-ranking-row-${person.id}`}
                >
                  <span className="w-8 text-center text-sm font-mono font-bold text-muted-foreground shrink-0">
                    #{rank}
                  </span>
                  <PersonAvatar name={person.name} avatar={person.avatar} className="h-11 w-11 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/person/${person.id}`}>
                        <span className="font-semibold truncate hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors">
                          {person.name}
                        </span>
                      </Link>
                      {person.category && (
                        <CategoryPill category={person.category} size="sm" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Trend Score{" "}
                      <span className="font-mono text-foreground">
                        {(person.fameIndex ?? 0).toLocaleString("en-US")}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      ↗ {Math.round(u)}% underrated · {Math.round(f)}% fair · ↘ {Math.round(o)}% overrated
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
