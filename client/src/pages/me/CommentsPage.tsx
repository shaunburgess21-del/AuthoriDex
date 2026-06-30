import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  MessageSquare,
  Eye,
  History,
  MessagesSquare,
  CornerDownRight,
  UserCircle,
} from "lucide-react";
import { navigateToLogin } from "@/lib/authReturn";
import { useAuth } from "@/contexts/AuthContext";
import { getAuthHeaders } from "@/lib/queryClient";
import { ProfileTabs, type ProfileTab } from "@/components/ProfileTabs";
import { MyCommentCard } from "@/components/me/MyCommentCard";
import { cn } from "@/lib/utils";
import type {
  MeCommentFilter,
  MeCommentItem,
  MeCommentsResponse,
} from "@shared/me-comments";

const VALID_TABS = ["overview", "history"] as const;
type CommentsTab = (typeof VALID_TABS)[number];

const TABS: ProfileTab[] = [
  { id: "overview", label: "Overview", icon: Eye, accent: "#3C83F6" },
  { id: "history", label: "History", icon: History, accent: "#3B82F6" },
];

const FILTERS: { value: MeCommentFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "timeline", label: "Timeline" },
  { value: "replies", label: "Replies" },
  { value: "insights", label: "Insights" },
];

function getInitialTab(): CommentsTab {
  if (typeof window === "undefined") return "overview";
  const param = new URLSearchParams(window.location.search).get("tab");
  return VALID_TABS.includes(param as CommentsTab) ? (param as CommentsTab) : "overview";
}

function StatTile({
  value,
  label,
  icon: Icon,
}: {
  value: number;
  label: string;
  icon: typeof MessageSquare;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 text-center">
      <Icon className="h-4 w-4 mx-auto mb-1.5 text-blue-600 dark:text-blue-400" />
      <p className="text-xl font-bold">{value.toLocaleString("en-US")}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

export default function CommentsPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<CommentsTab>(getInitialTab);
  const [filter, setFilter] = useState<MeCommentFilter>("all");

  const handleTabChange = (next: string) => {
    const tab = VALID_TABS.includes(next as CommentsTab) ? (next as CommentsTab) : "overview";
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (tab === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    }
  };

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<MeCommentsResponse>({
    queryKey: ["/api/me/comments", filter],
    enabled: !!user,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ filter });
      if (pageParam) params.set("cursor", pageParam as string);
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/me/comments?${params.toString()}`, {
        headers: authHeaders,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch comments");
      return res.json();
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your comments</h2>
          <Button
            onClick={() => navigateToLogin(setLocation)}
            className="mt-4"
            data-testid="button-sign-in"
          >
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const stats = data?.pages[0]?.stats;
  const items: MeCommentItem[] = data?.pages.flatMap((p) => p.items) ?? [];
  const initialLoading = isLoading && !data;

  const openThread = (item: MeCommentItem) => setLocation(item.threadHref);

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Comments</h1>
            <p className="text-xs text-muted-foreground">Everything you've posted and replied to</p>
          </div>
        </div>
      </header>

      <div
        id="profile-tabs-section"
        className="sticky top-14 z-40 border-b bg-background/80 backdrop-blur-xl"
      >
        <div className="container mx-auto px-2 sm:px-4 py-2 max-w-[964px]">
          <ProfileTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            tabs={TABS}
            noBottomMargin
          />
        </div>
      </div>

      <div className="container mx-auto px-2 sm:px-4 py-6 max-w-[964px] space-y-6">
        {activeTab === "overview" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile value={stats?.totalComments ?? 0} label="Comments" icon={MessageSquare} />
            <StatTile value={stats?.totalTimelinePosts ?? 0} label="Timeline Posts" icon={MessagesSquare} />
            <StatTile value={stats?.totalReplies ?? 0} label="Replies" icon={CornerDownRight} />
            <StatTile value={stats?.totalInsights ?? 0} label="Insights" icon={UserCircle} />
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={filter === f.value}
                  data-testid={`comments-filter-${f.value}`}
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                    filter === f.value
                      ? "border-blue-500/50 bg-blue-500/15 text-blue-600 dark:text-blue-300"
                      : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {initialLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <Card className="p-8 text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-destructive" />
                <h2 className="text-lg font-semibold mb-2">Couldn&apos;t load your comments</h2>
                <p className="text-muted-foreground">Please try again in a moment.</p>
              </Card>
            ) : items.length === 0 ? (
              <Card className="p-8 text-center" data-testid="comments-empty-state">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-lg font-semibold mb-2">No comments yet</h2>
                <p className="text-muted-foreground mb-4">
                  Join the conversation on Voices — post a take, weigh in on a matchup, or reply to
                  someone. Everything you say shows up here.
                </p>
                <Button onClick={() => setLocation("/voices")} data-testid="button-go-to-voices">
                  Go to Voices
                </Button>
              </Card>
            ) : (
              <>
                <div className="space-y-3">
                  {items.map((item) => (
                    <MyCommentCard key={`${item.source}-${item.id}`} item={item} onOpen={openThread} />
                  ))}
                </div>
                {hasNextPage && (
                  <div className="flex justify-center pt-2">
                    <Button
                      variant="outline"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      data-testid="button-load-more-comments"
                    >
                      {isFetchingNextPage ? "Loading..." : "Load More"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
