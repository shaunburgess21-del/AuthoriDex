import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Loader2, MessagesSquare } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { apiRequest } from "@/lib/queryClient";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useScrollHideOffset } from "@/hooks/useScrollHideOffset";
import { cn } from "@/lib/utils";
import { VoiceCard } from "@/components/voices/VoiceCard";
import { VoicesFilterBar } from "@/components/voices/VoicesFilterBar";
import { VoicesComposer } from "@/components/voices/VoicesComposer";
import { VoiceDetailOverlay } from "@/components/voices/VoiceDetailOverlay";
import { useVoicesFeed, voicesFeedQueryKey } from "@/components/voices/useVoicesFeed";
import {
  EMPTY_VOICES_FILTERS,
  type VoicesFeedItem,
  type VoicesFeedMode,
  type VoicesFeedResponse,
  type VoicesFilters,
} from "@/components/voices/types";
import {
  VOICES_FEED_LANE_CLASS,
  VOICES_PAGE_CANVAS_CLASS,
  VOICES_PAGE_HEADER_CLASS,
  VOICES_POST_ROW_CLASS,
  VOICES_ROW_INNER_CLASS,
} from "@/components/voices/voicesSurface";

export default function VoicesPage() {
  const { user, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<VoicesFeedMode>("for-you");
  const [filters, setFilters] = useState<VoicesFilters>(EMPTY_VOICES_FILTERS);
  const [selected, setSelected] = useState<VoicesFeedItem | null>(null);

  // Scroll-linked hide/reveal of the filter sub-header (tracks scroll 1:1).
  const headerRef = useRef<HTMLDivElement>(null);
  const headerOffset = useScrollHideOffset(headerRef);

  const isAuthenticated = isLoggedIn || !!user;

  useEffect(() => {
    document.title = "Voices | VoxDex";
    return () => {
      document.title = "VoxDex";
    };
  }, []);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useVoicesFeed({ mode, filters });

  const items = useMemo(() => {
    const flat = (data?.pages ?? []).flatMap((p) => p.items);
    const seen = new Set<string>();
    return flat.filter((i) => {
      const key = `${i.source}:${i.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);

  const { ref: sentinelRef, isIntersecting } = useIntersectionObserver({
    rootMargin: "400px",
    enabled: hasNextPage && !isFetchingNextPage,
  });

  useEffect(() => {
    if (isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [isIntersecting, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Deep link: /voices?post=<id> opens the post overlay directly.
  useEffect(() => {
    const postId = new URLSearchParams(window.location.search).get("post");
    if (!postId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/voices/post/${postId}`);
        const json = (await res.json()) as { post: VoicesFeedItem | null };
        if (!cancelled && json.post) setSelected(json.post);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleVote = useCallback(
    (item: VoicesFeedItem) => {
      if (!isAuthenticated) {
        navigateToLogin(setLocation);
        return;
      }
      const key = voicesFeedQueryKey(mode, filters);
      const willUpvote = item.userVote !== "up";

      // Optimistically toggle the upvote across cached pages (no refetch so the
      // feed order + scroll position stay put).
      queryClient.setQueryData<InfiniteData<VoicesFeedResponse>>(key, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: prev.pages.map((page) => ({
            ...page,
            items: page.items.map((i) =>
              i.id === item.id && i.source === item.source
                ? {
                    ...i,
                    userVote: willUpvote ? "up" : null,
                    upvotes: Math.max(0, i.upvotes + (willUpvote ? 1 : -1)),
                  }
                : i,
            ),
          })),
        };
      });

      // After the community_insights → comments merge, all feed items (including
      // top-level profile posts with source="insight") are comments rows — vote
      // goes through the standard /api/comments endpoint.
      const endpoint = `/api/comments/${item.id}/vote`;
      apiRequest("POST", endpoint, { voteType: "up" }).catch(() => {
        // Revert on failure.
        queryClient.setQueryData<InfiniteData<VoicesFeedResponse>>(key, (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            pages: prev.pages.map((page) => ({
              ...page,
              items: page.items.map((i) =>
                i.id === item.id && i.source === item.source ? item : i,
              ),
            })),
          };
        });
      });
    },
    [isAuthenticated, setLocation, queryClient, mode, filters],
  );

  return (
    <div className={cn("min-h-screen bg-background pb-20 md:pb-0", VOICES_PAGE_CANVAS_CLASS)}>
      <SiteHeader active="voices" />

      <div
        ref={headerRef}
        className={cn(
          "sticky top-16 z-40 border-b bg-background/80 backdrop-blur-xl will-change-transform transition-transform duration-100 ease-out",
          VOICES_PAGE_HEADER_CLASS,
        )}
        style={{ transform: `translateY(-${headerOffset}px)` }}
      >
        <div className="container mx-auto max-w-2xl px-4 py-2.5">
          <VoicesFilterBar
            filters={filters}
            onChange={setFilters}
            mode={mode}
            onModeChange={setMode}
          />
        </div>
      </div>

      <main className="container mx-auto max-w-2xl px-0 py-0 sm:px-4 sm:py-4">
        <div className={VOICES_FEED_LANE_CLASS}>
          <VoicesComposer />

          {isLoading ? (
            <FeedSkeleton />
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Could not load Voices. Check your connection and try again.
              </p>
              <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isRefetching}>
                {isRefetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <EmptyState hasFilters={
              filters.surfaces.length + filters.personIds.length + filters.categories.length > 0
            } />
          ) : (
            <>
              {items.map((item) => (
                <VoiceCard
                  key={`${item.source}:${item.id}`}
                  item={item}
                  onOpen={setSelected}
                  onVote={handleVote}
                />
              ))}
              <div ref={sentinelRef} className="flex min-h-10 justify-center py-4">
                {isFetchingNextPage ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                ) : !hasNextPage ? (
                  <span className="text-xs text-muted-foreground">You&apos;re all caught up</span>
                ) : null}
              </div>
            </>
          )}
        </div>
      </main>

      <VoiceDetailOverlay item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function FeedSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className={VOICES_POST_ROW_CLASS}>
          <div className={VOICES_ROW_INNER_CLASS}>
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-6 w-40 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <MessagesSquare className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium">No voices yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {hasFilters
          ? "No posts match these filters. Try clearing a few."
          : "Be the first to share a take with the Town Square."}
      </p>
    </div>
  );
}
