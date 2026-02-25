import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trophy,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Medal,
  Target,
  ChevronRight,
  Zap,
} from "lucide-react";

type Period = "today" | "week" | "month" | "all";

interface LeaderboardUser {
  rank: number;
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isPublic: boolean;
  userRank: string;
  profitLoss: number;
  volume: number;
  winCount: number;
  totalResolved: number;
  winRate: number;
}

interface LeaderboardResponse {
  data: LeaderboardUser[];
  total: number;
  userEntry: LeaderboardUser | null;
}

const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  all: "All Time",
};

function RankCell({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40">
        <Trophy className="h-4 w-4 text-amber-400" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-400/20 border border-slate-400/40">
        <Medal className="h-4 w-4 text-slate-400" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-orange-700/20 border border-orange-700/40">
        <Medal className="h-4 w-4 text-orange-600" />
      </div>
    );
  }
  return (
    <span className="w-8 text-center font-mono text-sm text-muted-foreground tabular-nums">
      {rank}
    </span>
  );
}

function PnLCell({ value }: { value: number }) {
  if (value > 0) {
    return (
      <div className="flex items-center gap-1 text-emerald-400 font-mono text-sm tabular-nums">
        <TrendingUp className="h-3.5 w-3.5 shrink-0" />
        +{value.toLocaleString("en-US")}
      </div>
    );
  }
  if (value < 0) {
    return (
      <div className="flex items-center gap-1 text-red-400 font-mono text-sm tabular-nums">
        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
        {value.toLocaleString("en-US")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 text-muted-foreground font-mono text-sm tabular-nums">
      <Minus className="h-3.5 w-3.5 shrink-0" />0
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-border/50">
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <Skeleton className="w-8 h-8 rounded-full shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16 hidden sm:block" />
      <Skeleton className="h-4 w-12 hidden md:block" />
      <Skeleton className="h-4 w-10 hidden lg:block" />
    </div>
  );
}

function EmptyState() {
  const [, setLocation] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="h-20 w-20 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-6">
        <Trophy className="h-10 w-10 text-amber-400/60" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No resolved predictions yet</h3>
      <p className="text-muted-foreground text-sm max-w-sm mb-8">
        The leaderboard fills up once prediction markets settle. Place your bets and climb the ranks.
      </p>
      <Button
        className="bg-gradient-to-r from-blue-600 to-cyan-500 border-0"
        onClick={() => setLocation("/predict")}
        data-testid="button-go-predict"
      >
        <Target className="h-4 w-4 mr-2" />
        Make a Prediction
      </Button>
    </div>
  );
}

function UserRow({
  user,
  isCurrentUser,
  onRowClick,
}: {
  user: LeaderboardUser;
  isCurrentUser: boolean;
  onRowClick: (user: LeaderboardUser) => void;
}) {
  const initials = user.displayName.slice(0, 2).toUpperCase();

  return (
    <button
      className={`w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors text-left hover:bg-muted/30 ${
        isCurrentUser ? "bg-cyan-500/5 border-l-2 border-l-cyan-500/50" : ""
      }`}
      onClick={() => onRowClick(user)}
      data-testid={`row-leaderboard-user-${user.userId}`}
    >
      <div className="shrink-0">
        <RankCell rank={user.rank} />
      </div>

      <Avatar className="h-8 w-8 shrink-0">
        {user.avatarUrl ? (
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
        ) : (
          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-xs font-semibold">
            {initials}
          </AvatarFallback>
        )}
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{user.displayName}</span>
          {isCurrentUser && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-cyan-500/40 text-cyan-400 shrink-0">
              You
            </Badge>
          )}
        </div>
        {user.username && (
          <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
        )}
      </div>

      <div className="shrink-0 min-w-[90px] text-right">
        <PnLCell value={user.profitLoss} />
        <p className="text-[10px] text-muted-foreground mt-0.5">credits</p>
      </div>

      <div className="shrink-0 min-w-[70px] text-right hidden sm:block">
        <p className="font-mono text-sm text-muted-foreground tabular-nums">
          {user.volume.toLocaleString("en-US")}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">wagered</p>
      </div>

      <div className="shrink-0 min-w-[56px] text-right hidden md:block">
        <div className="flex items-center justify-end gap-1">
          <Zap className="h-3 w-3 text-amber-400" />
          <span className="font-mono text-sm tabular-nums">{user.winRate}%</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">win rate</p>
      </div>

      <div className="shrink-0 min-w-[40px] text-right hidden lg:block">
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          {user.totalResolved}
        </span>
        <p className="text-[10px] text-muted-foreground mt-0.5">bets</p>
      </div>

      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 hidden sm:block" />
    </button>
  );
}

export default function UserLeaderboardPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [, setLocation] = useLocation();
  const { isLoggedIn, profile } = useAuth();

  const { data, isLoading } = useQuery<LeaderboardResponse>({
    queryKey: ["/api/leaderboard/users", period, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ period });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await fetch(`/api/leaderboard/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    staleTime: 30_000,
  });

  const handleSearchChange = (val: string) => {
    setSearch(val);
    clearTimeout((window as any)._leaderboardSearchTimer);
    (window as any)._leaderboardSearchTimer = setTimeout(() => {
      setDebouncedSearch(val);
    }, 350);
  };

  const handleRowClick = (user: LeaderboardUser) => {
    if (user.username && user.isPublic) {
      setLocation(`/u/${user.username}`);
    }
  };

  const currentUserId = profile?.id;
  const rows = data?.data ?? [];
  const userEntry = data?.userEntry ?? null;
  const isUserVisibleOnPage = rows.some((r) => r.userId === currentUserId);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 pt-10 pb-20">
        {/* Page header */}
        <div className="flex items-start gap-4 mb-8">
          <div className="h-12 w-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
            <Trophy className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prediction Leaderboard</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Top predictors ranked by virtual credit profit
            </p>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {/* Period tabs */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-muted/50 border border-border/50">
            {(["today", "week", "month", "all"] as Period[]).map((p) => (
              <button
                key={p}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  period === p
                    ? "bg-background text-foreground shadow-sm border border-border/60"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setPeriod(p)}
                data-testid={`button-period-${p}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative flex-1 sm:max-w-xs sm:ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Search predictors..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              data-testid="input-search-predictors"
            />
          </div>
        </div>

        {/* Table header */}
        <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
          <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/30 border-b border-border/60 text-xs font-medium text-muted-foreground">
            <div className="w-8 shrink-0 text-center">#</div>
            <div className="w-8 shrink-0" />
            <div className="flex-1">Predictor</div>
            <div className="min-w-[90px] text-right shrink-0">P&L</div>
            <div className="min-w-[70px] text-right shrink-0 hidden sm:block">Volume</div>
            <div className="min-w-[56px] text-right shrink-0 hidden md:block">Win Rate</div>
            <div className="min-w-[40px] text-right shrink-0 hidden lg:block">Bets</div>
            <div className="w-4 hidden sm:block" />
          </div>

          {isLoading ? (
            <>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </>
          ) : rows.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {rows.map((user) => (
                <UserRow
                  key={user.userId}
                  user={user}
                  isCurrentUser={isLoggedIn && user.userId === currentUserId}
                  onRowClick={handleRowClick}
                />
              ))}
            </>
          )}

          {/* Sticky "You" row if logged in but not visible on current page */}
          {isLoggedIn && userEntry && !isUserVisibleOnPage && rows.length > 0 && (
            <div className="sticky bottom-0 border-t-2 border-cyan-500/40 bg-cyan-500/5 backdrop-blur-sm">
              <UserRow
                user={userEntry}
                isCurrentUser={true}
                onRowClick={handleRowClick}
              />
            </div>
          )}
        </div>

        {/* Result count */}
        {!isLoading && rows.length > 0 && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            Showing {rows.length} of {data?.total ?? rows.length} predictors
          </p>
        )}
      </div>
    </div>
  );
}
