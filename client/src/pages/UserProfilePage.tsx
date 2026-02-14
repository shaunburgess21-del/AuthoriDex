import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { UserMenu } from "@/components/UserMenu";
import { ArrowLeft, Star, TrendingUp, Calendar, Award } from "lucide-react";
import { UserVote, UserFavourite } from "@shared/schema";
import { format } from "date-fns";
import { voteToApprovalPercent } from "@/lib/utils";

// 1-5 scale colors: vivid gradient from red (1) to green (5)
const SEGMENT_COLORS_5 = [
  '#FF0000', // 1 - Pure red (0%)
  '#FF9100', // 2 - Orange (25%)
  '#FFC400', // 3 - Golden amber (50% - Neutral)
  '#76FF03', // 4 - Neon green (75%)
  '#00C853', // 5 - Pure green (100%)
];

const getSentimentColor = (value: number): string => {
  if (value < 1 || value > 5) return '#888888';
  return SEGMENT_COLORS_5[value - 1];
};

export default function UserProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [favourites, setFavourites] = useState<UserFavourite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      setLocation("/login");
    }
  }, [user, authLoading, setLocation]);

  useEffect(() => {
    if (!user) return;

    async function fetchUserData() {
      try {
        const supabase = await getSupabase();

        const [votesResult, favouritesResult] = await Promise.all([
          supabase
            .from("user_votes")
            .select("*")
            .eq("userId", user!.id)
            .order("votedAt", { ascending: false }),
          supabase
            .from("user_favourites")
            .select("*")
            .eq("userId", user!.id)
            .order("favouritedAt", { ascending: false }),
        ]);

        if (votesResult.data) setVotes(votesResult.data as UserVote[]);
        if (favouritesResult.data) setFavourites(favouritesResult.data as UserFavourite[]);
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchUserData();
  }, [user]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const getInitials = () => {
    if (user.user_metadata?.full_name) {
      return user.user_metadata.full_name
        .split(" ")
        .map((n: string) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (user.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "U";
  };

  const averageRating = votes.length > 0
    ? votes.reduce((sum, vote) => sum + vote.rating, 0) / votes.length
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/");
                }
              }}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div 
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setLocation("/")}
              data-testid="link-logo-home"
            >
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-primary-foreground font-bold font-serif text-lg">F</span>
              </div>
              <span className="font-serif font-bold text-xl">AuthoriDex</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1 mr-2">
              <Button variant="ghost" size="sm" onClick={() => setLocation("/#leaderboard")} data-testid="nav-leaderboard-desktop">
                Leaderboard
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setLocation("/vote");
                window.scrollTo(0, 0);
              }} data-testid="nav-vote-desktop">
                Vote
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setLocation("/predict")} data-testid="nav-predict-desktop">
                Predict
              </Button>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-6 items-start">
                <Avatar className="h-24 w-24">
                  <AvatarImage src={user.user_metadata?.avatar_url} alt={user.email || "User"} />
                  <AvatarFallback className="text-2xl">{getInitials()}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h1 className="text-3xl font-bold font-serif mb-2">
                    {user.user_metadata?.full_name || "User Profile"}
                  </h1>
                  <p className="text-muted-foreground mb-4">{user.email}</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center p-3 rounded-lg bg-muted/30">
                      <div className="text-2xl font-bold">{votes.length}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Votes</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/30">
                      <div className="text-2xl font-bold">{favourites.length}</div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Favourites</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/30">
                      <div className="text-2xl font-bold">
                        {averageRating > 0 ? `${voteToApprovalPercent(averageRating)}%` : "—"}
                      </div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Avg Rating</div>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-muted/30">
                      <div className="text-2xl font-bold">
                        {votes.filter(v => v.rating >= 4).length}
                      </div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">High Scores</div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5" />
                Favourites
              </CardTitle>
              <CardDescription>
                Your starred celebrities ({favourites.length})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : favourites.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Star className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>No favourites yet</p>
                  <p className="text-sm mt-1">Star your favorite celebrities to see them here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {favourites.slice(0, 10).map((fav) => (
                    <div
                      key={fav.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover-elevate active-elevate-2 cursor-pointer"
                      onClick={() => setLocation(`/person/${fav.personId}`)}
                      data-testid={`favourite-${fav.personId}`}
                    >
                      <PersonAvatar
                        name={fav.personName}
                        avatar={fav.personAvatar || undefined}
                        size="sm"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{fav.personName}</p>
                        {fav.personCategory && (
                          <p className="text-sm text-muted-foreground truncate">
                            {fav.personCategory}
                          </p>
                        )}
                      </div>
                      <Star className="h-4 w-4 fill-primary text-primary" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Recent Votes
              </CardTitle>
              <CardDescription>
                Your sentiment ratings ({votes.length})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Loading...</div>
              ) : votes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Award className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p>No votes yet</p>
                  <p className="text-sm mt-1">Cast your first vote on the leaderboard</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {votes.slice(0, 10).map((vote) => (
                    <div
                      key={vote.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover-elevate active-elevate-2 cursor-pointer"
                      onClick={() => setLocation(`/person/${vote.personId}`)}
                      data-testid={`vote-${vote.personId}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{vote.personName}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(vote.votedAt), "MMM d, yyyy")}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-xl font-bold"
                          style={{ color: getSentimentColor(vote.rating) }}
                        >
                          {voteToApprovalPercent(vote.rating)}%
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {vote.rating}/5
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {(votes.length > 0 || favourites.length > 0) && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Insights</CardTitle>
              <CardDescription>Based on your activity</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {votes.length > 0 && (
                  <>
                    <div className="p-4 rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground mb-1">Most Positive</p>
                      <p className="font-semibold">
                        {votes.reduce((max, v) => (v.rating > max.rating ? v : max)).personName}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/30">
                      <p className="text-sm text-muted-foreground mb-1">Latest Vote</p>
                      <p className="font-semibold">{votes[0]?.personName || "—"}</p>
                    </div>
                  </>
                )}
                <div className="p-4 rounded-lg bg-muted/30">
                  <p className="text-sm text-muted-foreground mb-1">Total Activity</p>
                  <p className="font-semibold">{votes.length + favourites.length} actions</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
