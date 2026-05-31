import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonAvatar } from "@/components/PersonAvatar";
import { UserProfileAvatar } from "@/components/UserProfileAvatar";
import { SiteHeader } from "@/components/SiteHeader";
import { Star, TrendingUp, Calendar, Award, Lightbulb, ExternalLink } from "lucide-react";
import { UserVote, UserFavourite } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { voteToApprovalPercent } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

interface MySuggestion {
  id: string;
  type: string;
  status: string;
  category: string | null;
  createdAt: string;
  approvedAsId: string | null;
  approvedAsType: string | null;
  adminNotes: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  matchup: "Matchup",
  sentiment_poll: "Sentiment Poll",
  opinion_poll: "Opinion Poll",
  induction: "Induction",
  profile_image: "Profile Image",
  open_market: "Open Market",
};

const TYPE_BADGE_CLASS: Record<string, string> = {
  matchup: "bg-cyan-500/15 border-cyan-500/40 text-cyan-600 dark:text-cyan-300",
  sentiment_poll: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  opinion_poll: "bg-violet-500/15 border-violet-500/40 text-violet-600 dark:text-violet-300",
  induction: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  profile_image: "bg-slate-500/15 border-slate-500/40 text-slate-600 dark:text-slate-300",
  open_market: "bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-300",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300",
  approved: "bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
  rejected: "bg-red-500/15 border-red-500/40 text-red-600 dark:text-red-300",
};

const APPROVED_LINK: Record<string, string> = {
  matchup: "/vote",
  sentiment_poll: "/vote",
  opinion_poll: "/vote",
  induction: "/vote/induction",
  open_market: "/predict",
};

function getLiveLink(s: MySuggestion): string | null {
  if (s.status !== "approved") return null;
  // profile_image approvedAsId is the celebrity's personId — link to their profile.
  if (s.type === "profile_image" && s.approvedAsId) return `/person/${s.approvedAsId}`;
  return APPROVED_LINK[s.type] ?? null;
}

// 1-5 scale colors: vivid gradient from red (1) to green (5)
const SEGMENT_COLORS_5 = [
  '#FF0000',
  '#FF9100',
  '#FFC400',
  '#76FF03',
  '#00C853',
];

const getSentimentColor = (value: number): string => {
  if (value < 1 || value > 5) return '#888888';
  return SEGMENT_COLORS_5[value - 1];
};

/** PostgREST returns snake_case columns; normalize to Drizzle-inferred shape */
function normalizeUserVoteRow(row: Record<string, unknown>): UserVote {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    personId: String(row.person_id ?? row.personId ?? ""),
    personName: String(row.person_name ?? row.personName ?? ""),
    rating: Number(row.rating ?? 0),
    votedAt: new Date(String(row.voted_at ?? row.votedAt ?? Date.now())),
  };
}

function normalizeUserFavouriteRow(row: Record<string, unknown>): UserFavourite {
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? row.userId ?? ""),
    personId: String(row.person_id ?? row.personId ?? ""),
    personName: String(row.person_name ?? row.personName ?? ""),
    personAvatar: (row.person_avatar ?? row.personAvatar) as string | null,
    personCategory: (row.person_category ?? row.personCategory) as string | null,
    favouritedAt: new Date(String(row.favourited_at ?? row.favouritedAt ?? Date.now())),
  };
}

export default function UserProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [votes, setVotes] = useState<UserVote[]>([]);
  const [favourites, setFavourites] = useState<UserFavourite[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<MySuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "suggestions">("overview");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  useEffect(() => {
    if (!authLoading && !user) {
      navigateToLogin(setLocation);
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
            .eq("user_id", user!.id)
            .order("voted_at", { ascending: false }),
          supabase
            .from("user_favourites")
            .select("*")
            .eq("user_id", user!.id)
            .order("favourited_at", { ascending: false }),
        ]);

        if (votesResult.data) {
          setVotes(votesResult.data.map((r) => normalizeUserVoteRow(r as Record<string, unknown>)));
        }
        if (favouritesResult.data) {
          setFavourites(
            favouritesResult.data.map((r) => normalizeUserFavouriteRow(r as Record<string, unknown>)),
          );
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchUserData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    async function fetchSuggestions() {
      try {
        const res = await apiRequest("GET", "/api/suggestions/mine");
        const data: MySuggestion[] = await res.json();
        setSuggestions(data);
      } catch (error) {
        console.error("Error fetching suggestions:", error);
      } finally {
        setSuggestionsLoading(false);
      }
    }
    fetchSuggestions();
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

  const profileDisplayName = user.user_metadata?.full_name || user.email || "";

  const averageRating = votes.length > 0
    ? votes.reduce((sum, vote) => sum + vote.rating, 0) / votes.length
    : 0;

  const pendingCount = suggestions.filter(s => s.status === "pending").length;
  const approvedCount = suggestions.filter(s => s.status === "approved").length;
  const rejectedCount = suggestions.filter(s => s.status === "rejected").length;

  const filteredSuggestions = statusFilter === "all"
    ? suggestions
    : suggestions.filter(s => s.status === statusFilter);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader backButton="always" />

      <div className="container mx-auto px-2 sm:px-4 py-8 max-w-6xl">
        {/* Profile card */}
        <div className="mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-6 items-start">
                <UserProfileAvatar
                  displayName={profileDisplayName}
                  avatarUrl={user.user_metadata?.avatar_url}
                  size="xl"
                />
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

        {/* Tab navigation */}
        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg mb-6 w-fit">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === "overview"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-overview"
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("suggestions")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
              activeTab === "suggestions"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-suggestions"
          >
            My Suggestions
            {!suggestionsLoading && suggestions.length > 0 && (
              pendingCount > 0 ? (
                <Badge className="ml-1 text-xs bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-300 border">
                  {pendingCount} pending
                </Badge>
              ) : (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {suggestions.length}
                </Badge>
              )
            )}
          </button>
        </div>

        {/* Overview tab */}
        {activeTab === "overview" && (
          <>
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
          </>
        )}

        {/* My Suggestions tab */}
        {activeTab === "suggestions" && (
          <div className="space-y-4">
            {/* Status filter pills */}
            {!suggestionsLoading && suggestions.length > 0 && (
              <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit flex-wrap">
                {(["all", "pending", "approved", "rejected"] as const).map((f) => {
                  const count = f === "all" ? suggestions.length : f === "pending" ? pendingCount : f === "approved" ? approvedCount : rejectedCount;
                  return (
                    <button
                      key={f}
                      onClick={() => setStatusFilter(f)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                        statusFilter === f
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      data-testid={`filter-${f}`}
                    >
                      {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Suggestion cards */}
            {suggestionsLoading ? (
              <div className="text-center py-12 text-muted-foreground">Loading...</div>
            ) : suggestions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Lightbulb className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium mb-1">No suggestions submitted yet.</p>
                <p className="text-sm">Use the + Suggest buttons on the Vote and Predict pages to contribute!</p>
              </div>
            ) : filteredSuggestions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No {statusFilter} suggestions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSuggestions.map((s) => (
                  <Card
                    key={s.id}
                    className="p-4 shadow-sm border-border/60 bg-card/80"
                    data-testid={`suggestion-${s.id}`}
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                            TYPE_BADGE_CLASS[s.type] ?? "bg-muted border-border text-foreground"
                          }`}
                        >
                          {TYPE_LABEL[s.type] ?? s.type}
                        </span>
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${
                            STATUS_BADGE_CLASS[s.status] ?? "bg-muted border-border text-foreground"
                          }`}
                        >
                          {s.status}
                        </span>
                        {s.category && (
                          <span className="text-xs text-muted-foreground capitalize">{s.category}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                      </span>
                    </div>

                    {/* Pending indicator */}
                    {s.status === "pending" && (
                      <p className="mt-2 text-xs text-muted-foreground">Under review</p>
                    )}

                    {/* Approved: View on Site link */}
                    {getLiveLink(s) && (
                      <div className="mt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-primary hover:text-primary"
                          onClick={() => setLocation(getLiveLink(s)!)}
                          data-testid={`suggestion-link-${s.id}`}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View on Site →
                        </Button>
                      </div>
                    )}

                    {/* Rejected: admin notes */}
                    {s.status === "rejected" && s.adminNotes && (
                      <div className="mt-2 p-2 rounded-md bg-red-500/5 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                        <span className="font-medium">Feedback: </span>{s.adminNotes}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
