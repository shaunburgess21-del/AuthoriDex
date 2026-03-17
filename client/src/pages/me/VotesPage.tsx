import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ArrowLeft,
  Vote,
  Swords,
  TrendingUp,
  TrendingDown,
  BarChart3,
  MessageCircle,
  ImageIcon,
  UserPlus,
  Star,
  ChevronDown,
  Check,
} from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getAuthHeaders } from "@/lib/queryClient";

const VOTE_TYPES = [
  { value: "face_off", label: "Matchups", icon: Swords },
  { value: "sentiment", label: "Sentiment", icon: TrendingUp },
  { value: "value_vote", label: "Value Votes", icon: Star },
  { value: "trending_poll", label: "Polls", icon: BarChart3 },
  { value: "opinion_poll", label: "Opinion Polls", icon: MessageCircle },
  { value: "image_curate", label: "Image Curate", icon: ImageIcon },
  { value: "induction", label: "Induction", icon: UserPlus },
] as const;

type VoteTypeValue = (typeof VOTE_TYPES)[number]["value"];

function getVoteIcon(voteType: string, value: number) {
  switch (voteType) {
    case "face_off":
      return <Swords className="h-5 w-5 text-purple-400" />;
    case "sentiment":
      return value > 0
        ? <TrendingUp className="h-5 w-5 text-green-400" />
        : <TrendingDown className="h-5 w-5 text-red-400" />;
    case "value_vote":
      return value > 0
        ? <TrendingUp className="h-5 w-5 text-green-400" />
        : value < 0
          ? <TrendingDown className="h-5 w-5 text-red-400" />
          : <Star className="h-5 w-5 text-amber-400" />;
    case "trending_poll":
      return <BarChart3 className="h-5 w-5 text-blue-400" />;
    case "opinion_poll":
      return <MessageCircle className="h-5 w-5 text-cyan-400" />;
    case "image_curate":
      return <ImageIcon className="h-5 w-5 text-pink-400" />;
    case "induction":
      return <UserPlus className="h-5 w-5 text-amber-400" />;
    default:
      return <Vote className="h-5 w-5 text-muted-foreground" />;
  }
}

function getVoteTypeLabel(voteType: string) {
  return VOTE_TYPES.find((t) => t.value === voteType)?.label ?? voteType;
}

export default function VotesPage() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();
  const [activeFilter, setActiveFilter] = useState<VoteTypeValue | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const { data: votes, isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/me/votes", activeFilter],
    queryFn: async () => {
      const url = activeFilter
        ? `/api/me/votes?type=${activeFilter}`
        : "/api/me/votes";
      const authHeaders = await getAuthHeaders();
      const res = await fetch(url, { credentials: "include", headers: authHeaders });
      if (!res.ok) throw new Error("Failed to fetch votes");
      return res.json();
    },
    enabled: !!user,
  });

  const totalCount = useMemo(() => {
    if (votes && Array.isArray(votes)) return votes.length;
    return profile?.totalVotes || 0;
  }, [votes, profile?.totalVotes]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your votes</h2>
          <Button onClick={() => setLocation("/login")} className="mt-4" data-testid="button-sign-in">
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) {
                window.history.back();
              } else {
                setLocation("/me");
              }
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Votes</h1>
            <p className="text-xs text-muted-foreground">
              {totalCount} {activeFilter ? getVoteTypeLabel(activeFilter).toLowerCase() : ""} vote{totalCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {activeFilter ? getVoteTypeLabel(activeFilter) : "All Votes"}
            </Badge>
            {activeFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                onClick={() => setActiveFilter(null)}
              >
                Clear
              </Button>
            )}
          </div>

          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-filter-votes">
                <ChevronDown className="h-4 w-4 mr-2" />
                Filter
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors text-left"
                onClick={() => { setActiveFilter(null); setFilterOpen(false); }}
              >
                <Vote className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">All Votes</span>
                {!activeFilter && <Check className="h-4 w-4 text-primary" />}
              </button>
              {VOTE_TYPES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.value}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted/50 transition-colors text-left"
                    onClick={() => { setActiveFilter(t.value); setFilterOpen(false); }}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{t.label}</span>
                    {activeFilter === t.value && <Check className="h-4 w-4 text-primary" />}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : error ? (
          <Card className="p-8 text-center">
            <Vote className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load votes</h2>
            <p className="text-muted-foreground mb-4">
              Please try again in a moment.
            </p>
            <Button onClick={() => window.location.reload()} data-testid="button-retry-votes">
              Retry
            </Button>
          </Card>
        ) : votes && Array.isArray(votes) && votes.length > 0 ? (
          <div className="space-y-3">
            {votes.map((vote: any) => (
              <Card key={vote.id} className="p-4" data-testid={`vote-item-${vote.id}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {getVoteIcon(vote.voteType, vote.value)}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{vote.targetName || "Unknown"}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {getVoteTypeLabel(vote.voteType)}
                        </span>
                        {vote.detail && (
                          <>
                            <span className="text-xs text-muted-foreground/50">·</span>
                            <span className="text-xs text-muted-foreground truncate">
                              {vote.detail}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-xs text-muted-foreground">
                      {new Date(vote.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <Vote className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">No votes yet</h2>
            <p className="text-muted-foreground mb-4">
              Start voting on celebrities and polls to see your activity here.
            </p>
            <Button onClick={() => setLocation("/vote")} data-testid="button-start-voting">
              Start Voting
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
