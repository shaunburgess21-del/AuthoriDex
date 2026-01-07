import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ArrowLeft, User, Trophy, Vote, TrendingUp, Calendar, Lock, Sparkles, Shield } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface PublicProfile {
  username: string;
  fullName: string | null;
  avatarUrl: string | null;
  rank: string;
  xpPoints: number;
  totalVotes: number;
  totalPredictions: number;
  winRate: number;
  isPublic: boolean;
  createdAt: string;
}

function RankBadge({ rank }: { rank: string }) {
  const badgeConfig: Record<string, { color: string; icon: typeof Shield }> = {
    "Citizen": { color: "bg-blue-500/20 text-blue-300 border-blue-500/30", icon: Shield },
    "Engaged": { color: "bg-green-500/20 text-green-300 border-green-500/30", icon: Shield },
    "Contributor": { color: "bg-teal-500/20 text-teal-300 border-teal-500/30", icon: Sparkles },
    "Influencer": { color: "bg-purple-500/20 text-purple-300 border-purple-500/30", icon: Sparkles },
    "Trendsetter": { color: "bg-pink-500/20 text-pink-300 border-pink-500/30", icon: Sparkles },
    "Fame Maker": { color: "bg-orange-500/20 text-orange-300 border-orange-500/30", icon: Trophy },
    "Hall of Famer": { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", icon: Trophy },
  };

  const config = badgeConfig[rank] || badgeConfig["Citizen"];
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`${config.color}`}>
      <Icon className="h-3 w-3 mr-1" />
      {rank}
    </Badge>
  );
}

export default function PublicProfilePage() {
  const [, params] = useRoute("/u/:username");
  const [, setLocation] = useLocation();
  const username = params?.username;

  const { data: profile, isLoading, error } = useQuery<PublicProfile>({
    queryKey: ["/api/profile/u", username],
    enabled: !!username,
  });

  const xpLevel = Math.floor((profile?.xpPoints || 0) / 500) + 1;

  if (isLoading) {
    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <Skeleton className="h-6 w-32" />
          </div>
        </header>
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    const errorMessage = (error as any)?.message?.includes("private") 
      ? "This profile is private"
      : "User not found";
    const isPrivate = errorMessage.includes("private");

    return (
      <div className="min-h-screen pb-20 md:pb-0">
        <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4 h-14 flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setLocation("/")}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <span className="font-semibold">Profile</span>
          </div>
        </header>
        <div className="container mx-auto px-4 py-16 max-w-md">
          <Card className="p-8 text-center">
            {isPrivate ? (
              <>
                <Lock className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">Private Profile</h2>
                <p className="text-muted-foreground">
                  This user has chosen to keep their profile private.
                </p>
              </>
            ) : (
              <>
                <User className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">User Not Found</h2>
                <p className="text-muted-foreground">
                  The user @{username} does not exist.
                </p>
              </>
            )}
            <Button 
              variant="outline" 
              className="mt-6"
              onClick={() => setLocation("/")}
              data-testid="button-go-home"
            >
              Go to Homepage
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  const displayName = profile.fullName || profile.username || "User";
  const memberSince = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", { 
    year: "numeric", 
    month: "long" 
  }) : "2024";

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="font-semibold">@{profile.username}</span>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <Card className="p-6 mb-6">
          <div className="flex items-start gap-4 mb-6">
            <Avatar className="h-20 w-20">
              {profile.avatarUrl ? (
                <AvatarImage src={profile.avatarUrl} alt={displayName} />
              ) : (
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white font-semibold text-2xl">
                  {displayName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold truncate">{displayName}</h1>
              <p className="text-muted-foreground">@{profile.username}</p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <RankBadge rank={profile.rank || "Citizen"} />
                <Badge variant="secondary" className="font-mono">
                  Level {xpLevel}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Calendar className="h-4 w-4" />
            <span>Member since {memberSince}</span>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-4 rounded-lg bg-muted/50">
              <Vote className="h-5 w-5 mx-auto mb-2 text-cyan-400" />
              <p className="text-2xl font-bold">{profile.totalVotes || 0}</p>
              <p className="text-xs text-muted-foreground">Votes Cast</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <TrendingUp className="h-5 w-5 mx-auto mb-2 text-violet-400" />
              <p className="text-2xl font-bold">{profile.totalPredictions || 0}</p>
              <p className="text-xs text-muted-foreground">Predictions</p>
            </div>
            <div className="p-4 rounded-lg bg-muted/50">
              <Trophy className="h-5 w-5 mx-auto mb-2 text-amber-400" />
              <p className="text-2xl font-bold">{profile.winRate || 0}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">XP Progress</h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-muted-foreground">Level {xpLevel}</span>
                <span className="font-mono text-amber-400">{profile.xpPoints?.toLocaleString() || 0} XP</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full"
                  style={{ width: `${((profile.xpPoints || 0) % 500) / 5}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {500 - ((profile.xpPoints || 0) % 500)} XP to next level
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
