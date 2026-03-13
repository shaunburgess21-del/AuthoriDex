import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AuthoriDexLogo } from "@/components/AuthoriDexLogo";
import { UserMenu } from "@/components/UserMenu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { getAvatarInitials, getAvatarGradient, HUMAN_AVATAR_FALLBACK_CLASS, AGENT_AVATAR_FALLBACK_CLASS } from "@/lib/avatar";

interface ActivityItem {
  id: string;
  createdAt: string;
  stakeAmount: number;
  confidence: number | null;
  choiceLabel: string;
  marketId: string;
  marketTitle: string;
  marketSlug: string;
  marketType: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
  isPublic: boolean;
  rationale: string | null;
}

function formatActivityAge(timestamp: string) {
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

export default function TownSquarePage() {
  const [, setLocation] = useLocation();

  const { data: activity = [], isLoading, isError } = useQuery<ActivityItem[]>({
    queryKey: ["/api/predict/recent-activity?limit=100"],
    staleTime: 60_000,
    refetchInterval: 90_000,
  });

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setLocation("/predict")}
              aria-label="Back to predictions"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <button
              onClick={() => {
                setLocation("/");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <AuthoriDexLogo size={32} variant="predict" />
              <span className="font-serif font-bold text-xl hidden sm:block">AuthoriDex</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
                Home
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")}>
                Predict
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/vote")}>
                Vote
              </Button>
              <Button variant="ghost" size="sm" className="text-violet-400">
                Town Square
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 pt-8 pb-20">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
              <MessageSquare className="h-6 w-6 text-violet-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Town Square</h1>
              <p className="text-muted-foreground text-sm mt-0.5">
                Latest prediction activity across all markets
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLocation("/predict")}
            className="hidden md:flex"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Predictions
          </Button>
        </div>

        {isLoading ? (
          <Card className="border-violet-500/10 bg-card/95">
            <div className="divide-y divide-border/50">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-60" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : isError ? (
          <Card className="border-violet-500/10 bg-card/95 p-8 text-center">
            <p className="text-muted-foreground mb-3">Something went wrong loading activity.</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>Try again</Button>
          </Card>
        ) : activity.length === 0 ? (
          <Card className="border-violet-500/10 bg-card/95 p-8 text-center">
            <p className="text-muted-foreground">No recent activity yet. Be the first to make a prediction!</p>
          </Card>
        ) : (
          <Card className="border-violet-500/10 bg-card/95">
            <div className="divide-y divide-border/50">
              {activity.map((item) => (
                <div
                  key={item.id}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
                >
                  <button
                    className={`shrink-0 rounded-full ${item.username && item.isPublic ? "cursor-pointer" : "cursor-default"}`}
                    onClick={() => item.username && item.isPublic && setLocation(`/u/${item.username}`)}
                    aria-label={item.username && item.isPublic ? `View ${item.displayName}'s profile` : item.displayName}
                    aria-disabled={!(item.username && item.isPublic)}
                  >
                    <Avatar className="h-9 w-9">
                      {item.avatarUrl && !item.isAgent ? (
                        <AvatarImage src={item.avatarUrl} alt={item.displayName} />
                      ) : (
                        <AvatarFallback
                          className={`${getAvatarGradient(item.displayName)} ${item.isAgent ? AGENT_AVATAR_FALLBACK_CLASS : HUMAN_AVATAR_FALLBACK_CLASS}`}
                        >
                          {getAvatarInitials(item.displayName)}
                        </AvatarFallback>
                      )}
                    </Avatar>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2 flex-wrap">
                      <button
                        className={`text-sm font-medium ${item.username && item.isPublic ? "hover:underline cursor-pointer" : "cursor-default"}`}
                        onClick={() => item.username && item.isPublic && setLocation(`/u/${item.username}`)}
                        aria-disabled={!(item.username && item.isPublic)}
                      >
                        {item.displayName}
                      </button>
                      <span className="text-[11px] text-muted-foreground">{formatActivityAge(item.createdAt)}</span>
                    </div>
                    <button
                      className="text-left"
                      onClick={() => {
                        if (item.marketType === "community") {
                          setLocation(`/markets/${item.marketSlug}`);
                        } else {
                          setLocation("/predict");
                        }
                      }}
                    >
                      <p className="text-sm text-foreground line-clamp-1 hover:underline">
                        backed <span className="font-semibold">{item.choiceLabel}</span> on {item.marketTitle}
                      </p>
                    </button>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.stakeAmount.toLocaleString("en-US")} credits{item.confidence != null ? ` • ${(item.confidence * 100).toFixed(0)}% confidence` : ""}
                    </p>
                    {item.rationale && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                        "{item.rationale}"
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
