import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Award, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { BadgeCard, type BadgeCardData } from "@/components/BadgeCard";
import { CATEGORY_LABELS, getRarityStyle } from "@/lib/badge-icons";
import {
  CATEGORY_CHIP_RADIUS,
  FILTER_ACTIVE_PILL_BADGES,
  FILTER_INACTIVE_PILL_BADGES,
} from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER = [
  "VOTING",
  "PREDICTION",
  "CONTENT",
  "STREAK",
  "SOCIAL",
  "PROFILE",
  "SPECIAL",
] as const;

const RARITY_RANK: Record<string, number> = {
  COMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};

type StatusFilter = "all" | "earned" | "locked";
type CategoryFilter = "ALL" | (typeof CATEGORY_ORDER)[number];

/**
 * Trophy cabinet at /me/badges. Renders all visible-on-frontend
 * badges from GET /api/me/badges (joined with the user's
 * user_badges) grouped by category. Earned-first ordering inside
 * each category lets users immediately see what they've collected
 * without scrolling past locked tiles.
 */
export default function BadgesPage() {
  const { user, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");

  const { data, isLoading } = useQuery<BadgeCardData[]>({
    queryKey: ["/api/me/badges"],
    enabled: isLoggedIn,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/badges");
      return res.json();
    },
  });

  const badges = data ?? [];

  const stats = useMemo(() => {
    const earned = badges.filter((b) => b.earned);
    const total = badges.length;
    const earnedCount = earned.length;
    let rarest: BadgeCardData | null = null;
    let latest: BadgeCardData | null = null;
    for (const b of earned) {
      const rRank = RARITY_RANK[b.rarity] ?? 0;
      const rarestRank = rarest ? RARITY_RANK[rarest.rarity] ?? 0 : -1;
      if (rRank > rarestRank) rarest = b;
      if (
        b.earnedAt &&
        (!latest || (latest.earnedAt && b.earnedAt > latest.earnedAt))
      ) {
        latest = b;
      }
    }
    return { earnedCount, total, rarest, latest };
  }, [badges]);

  const filtered = useMemo(() => {
    return badges.filter((b) => {
      if (statusFilter === "earned" && !b.earned) return false;
      if (statusFilter === "locked" && b.earned) return false;
      if (categoryFilter !== "ALL" && b.category !== categoryFilter) return false;
      return true;
    });
  }, [badges, statusFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, BadgeCardData[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const b of filtered) {
      const arr = map.get(b.category) ?? [];
      arr.push(b);
      map.set(b.category, arr);
    }
    // Earned-first within each group.
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (a.earned !== b.earned) return a.earned ? -1 : 1;
        return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      });
    }
    return Array.from(map.entries()).filter(([, arr]) => arr.length > 0);
  }, [filtered]);

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else setLocation("/me");
              }}
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
            >
              <VoxDexLogo size={32} />
              <span className="font-serif font-bold text-xl">VoxDex</span>
            </div>
          </div>
          <HeaderUserActions />
        </div>
      </header>

      <div className="container mx-auto max-w-4xl px-2 py-6 sm:px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-serif font-bold flex items-center gap-2" data-testid="text-badges-title">
            <Trophy className="h-7 w-7 text-amber-500" />
            My Badges
          </h1>
          <p className="text-muted-foreground mt-1">
            Your achievements across VoxDex — earned as you vote, predict, and engage.
          </p>
        </div>

        {!isLoggedIn || !user ? (
          <Card className="p-8 text-center">
            <Award className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Sign in to view your badges</h2>
            <Button onClick={() => navigateToLogin(setLocation)}>Sign In</Button>
          </Card>
        ) : isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            <StatsBar
              earnedCount={stats.earnedCount}
              total={stats.total}
              rarest={stats.rarest}
              latest={stats.latest}
            />

            <div className="space-y-3 my-5">
              <FilterChips
                label="Show"
                options={[
                  { id: "all", label: `All (${badges.length})` },
                  { id: "earned", label: `Earned (${stats.earnedCount})` },
                  { id: "locked", label: `Locked (${badges.length - stats.earnedCount})` },
                ]}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as StatusFilter)}
              />
              <FilterChips
                label="Category"
                options={[
                  { id: "ALL", label: "All" },
                  ...CATEGORY_ORDER.map((c) => ({
                    id: c,
                    label: CATEGORY_LABELS[c] ?? c,
                  })),
                ]}
                value={categoryFilter}
                onChange={(v) => setCategoryFilter(v as CategoryFilter)}
              />
            </div>

            {grouped.length === 0 ? (
              <Card className="p-8 text-center">
                <Sparkles className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {statusFilter === "earned"
                    ? "Cast your first vote to start earning badges"
                    : statusFilter === "locked"
                      ? "You've earned every visible badge in this filter."
                      : "No badges match this filter."}
                </p>
              </Card>
            ) : (
              <div className="space-y-6">
                {grouped.map(([category, rows]) => (
                  <section key={category} className="space-y-2">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                      {CATEGORY_LABELS[category] ?? category}
                      <span className="text-xs">
                        {rows.filter((r) => r.earned).length} / {rows.length}
                      </span>
                    </h2>
                    <div className="grid gap-2 md:grid-cols-2">
                      {rows.map((b) => (
                        <BadgeCard key={b.key} badge={b} size="catalog" />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatsBar({
  earnedCount,
  total,
  rarest,
  latest,
}: {
  earnedCount: number;
  total: number;
  rarest: BadgeCardData | null;
  latest: BadgeCardData | null;
}) {
  const rarestStyle = rarest ? getRarityStyle(rarest.rarity) : null;
  const statCardClass = "p-4 shadow-none pulse-card-green pulse-card-flush";
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Card className={statCardClass}>
        <p className="text-xs text-muted-foreground">Earned</p>
        <p className="text-2xl font-bold mt-1">
          {earnedCount}
          <span className="text-base text-muted-foreground"> / {total}</span>
        </p>
      </Card>
      <Card className={statCardClass}>
        <p className="text-xs text-muted-foreground">Rarest earned</p>
        {rarest && rarestStyle ? (
          <p className={cn("text-base font-semibold mt-1", rarestStyle.accent)}>
            {rarest.name}
          </p>
        ) : (
          <p className="text-base font-semibold mt-1 text-muted-foreground">—</p>
        )}
      </Card>
      <Card className={statCardClass}>
        <p className="text-xs text-muted-foreground">Latest</p>
        <p className="text-base font-semibold mt-1 truncate">
          {latest?.name ?? <span className="text-muted-foreground">—</span>}
        </p>
      </Card>
    </div>
  );
}

function FilterChips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
        {label}
      </span>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            CATEGORY_CHIP_RADIUS,
            "px-3 py-1.5 text-xs font-medium border transition-colors",
            value === opt.id
              ? FILTER_ACTIVE_PILL_BADGES
              : FILTER_INACTIVE_PILL_BADGES,
          )}
          data-testid={`badge-filter-${opt.id}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
