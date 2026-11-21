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
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";
import { useFavorites } from "@/hooks/useFavorites";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { useScrollHideOffset } from "@/hooks/useScrollHideOffset";
import { cn } from "@/lib/utils";
import { VoiceCard } from "@/components/voices/VoiceCard";
import { VoicesFilterBar } from "@/components/voices/VoicesFilterBar";
import { VoicesComposer } from "@/components/voices/VoicesComposer";
import { VoiceDetailOverlay } from "@/components/voices/VoiceDetailOverlay";
import { useVoicesFeed, voicesFeedQueryKey } from "@/components/voices/useVoicesFeed";
import { useVoicesPersonNames } from "@/components/voices/useVoicesPersonNames";
import {
  EMPTY_VOICES_FILTERS,
  type VoicesFeedItem,
  type VoicesFeedMode,
  type VoicesFeedResponse,
  type VoicesFilters,
} from "@/components/voices/types";
import {
  applyFavourites,
  categoryFilterLabel,
  clearFavourites,
  describeVoicesEmptyState,
  emptyStateClearGesture,
  favouritePersonIds,
  favouritesSelectionActive,
  nextVoicesHistoryAction,
  parseVoicesQuery,
  shouldShowFavouritesChip,
  type VoicesEmptyCopy,
} from "@/components/voices/voicesFilters";
import {
  VOICES_FEED_LANE_CLASS,
  VOICES_PAGE_CANVAS_CLASS,
  VOICES_PAGE_HEADER_CLASS,
  VOICES_POST_ROW_CLASS,
  VOICES_ROW_INNER_CLASS,
} from "@/components/voices/voicesSurface";

function readVoicesLocation(): { mode: VoicesFeedMode; filters: VoicesFilters } {
  if (typeof window === "undefined") {
    return { mode: "for-you", filters: EMPTY_VOICES_FILTERS };
  }
  return parseVoicesQuery(window.location.search);
}

function jumpToVoicesComposer() {
  document.getElementById("voices-composer")?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>('[data-testid="voices-composer-input"]')?.focus();
  }, 250);
}

export default function VoicesPage() {
  const { user, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<VoicesFeedMode>(() => readVoicesLocation().mode);
  const [filters, setFilters] = useState<VoicesFilters>(() => readVoicesLocation().filters);
  const [historyDeferred, setHistoryDeferred] = useState(false);
  const [selected, setSelected] = useState<VoicesFeedItem | null>(null);
  const canonicalizeHistoryRef = useRef(true);
  const historyFromPopRef = useRef(false);
  const { favorites, isAuthenticated: hasSession, isLoading: favoritesLoading } = useFavorites();
  const categoryRegistry = useCategoryRegistry();

  // Scroll-linked hide/reveal of the filter sub-header (tracks scroll 1:1).
  const headerRef = useRef<HTMLDivElement>(null);
  const headerOffset = useScrollHideOffset(headerRef);

  const isAuthenticated = isLoggedIn || !!user;

  const favouriteIds = useMemo(
    () => favouritePersonIds(favorites.map((favorite) => favorite.celebrityId)),
    [favorites],
  );
  const favouriteSeed = useMemo(() => {
    const seed: Record<string, string> = {};
    for (const favorite of favorites) {
      if (favorite.celebrityId && favorite.name) seed[favorite.celebrityId] = favorite.name;
    }
    return seed;
  }, [favorites]);
  const { names: personNames, remember: rememberPerson } = useVoicesPersonNames(
    filters.personIds,
    favouriteSeed,
  );
  const showFavourites = shouldShowFavouritesChip(hasSession, favouriteIds.length);
  const favouritesActive = favouritesSelectionActive(filters.personIds, favouriteIds);

  const registryLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of categoryRegistry.categories) {
      if (row.id && row.label) map.set(row.id, row.label);
    }
    return map;
  }, [categoryRegistry.categories]);

  const emptyCopy = useMemo(
    () =>
      describeVoicesEmptyState({
        filters,
        categoryLabel: (id) => categoryFilterLabel(id, registryLabels),
        personLabel: (id) => personNames[id] ?? "Celebrity",
        favouritesActive,
        favouriteIds,
      }),
    [filters, personNames, favouritesActive, favouriteIds, registryLabels],
  );

  useEffect(() => {
    document.title = "Voices | VoxDex";
    return () => {
      document.title = "VoxDex";
    };
  }, []);

  const onHistoryDeferChange = useCallback((defer: boolean) => {
    setHistoryDeferred((prev) => (prev === defer ? prev : defer));
  }, []);

  useEffect(() => {
    if (historyFromPopRef.current) {
      historyFromPopRef.current = false;
      canonicalizeHistoryRef.current = false;
      const next = nextVoicesHistoryAction({
        currentSearch: window.location.search,
        mode,
        filters,
        canonicalize: true,
        defer: false,
      });
      if (next.action === "replace") {
        const url = `${window.location.pathname}${next.search}${window.location.hash}`;
        window.history.replaceState(window.history.state, "", url);
      }
      return;
    }

    const decision = nextVoicesHistoryAction({
      currentSearch: window.location.search,
      mode,
      filters,
      canonicalize: canonicalizeHistoryRef.current,
      defer: historyDeferred,
    });
    if (!historyDeferred) canonicalizeHistoryRef.current = false;
    if (decision.action === "none") return;
    const url = `${window.location.pathname}${decision.search}${window.location.hash}`;
    if (decision.action === "replace") {
      window.history.replaceState(window.history.state, "", url);
    } else {
      window.history.pushState(window.history.state, "", url);
    }
  }, [mode, filters, historyDeferred]);

  useEffect(() => {
    const onPop = () => {
      historyFromPopRef.current = true;
      const next = readVoicesLocation();
      setHistoryDeferred(false);
      setMode(next.mode);
      setFilters(next.filters);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const toggleFavourites = useCallback(() => {
    setFilters((prev) => ({
      ...prev,
      personIds: favouritesSelectionActive(prev.personIds, favouriteIds)
        ? clearFavourites(prev.personIds, favouriteIds)
        : applyFavourites(favouriteIds),
    }));
  }, [favouriteIds]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isRefetching,
    isPlaceholderData,
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
      <SiteHeader active="voices" backButton="none" />

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
            personNames={personNames}
            onPersonResolved={(person) => rememberPerson(person.id, person.name)}
            showFavourites={showFavourites}
            favouriteIds={favouriteIds}
            favouritesResolving={hasSession && favoritesLoading}
            onToggleFavourites={toggleFavourites}
            onHistoryDeferChange={onHistoryDeferChange}
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
            isPlaceholderData ? (
              <div data-testid="voices-feed-refresh" aria-busy="true">
                <FeedSkeleton />
              </div>
            ) : (
              <EmptyState
                copy={emptyCopy}
                onClear={() => setFilters(EMPTY_VOICES_FILTERS)}
                onCompose={jumpToVoicesComposer}
              />
            )
          ) : (
            <div className="relative" aria-busy={isPlaceholderData}>
              {isPlaceholderData ? (
                <div
                  className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center"
                  data-testid="voices-feed-refresh"
                >
                  <span className="sr-only">Updating voices</span>
                  <Loader2 className="h-5 w-5 animate-spin rounded-full bg-background/80 text-muted-foreground" />
                </div>
              ) : null}
              <div className={cn(isPlaceholderData && "opacity-60 transition-opacity")}>
                {items.map((item, index) => (
                  <VoiceCard
                    key={`${item.source}:${item.id}`}
                    item={item}
                    onOpen={setSelected}
                    onVote={handleVote}
                    imagePriority={index < 3}
                  />
                ))}
                <div ref={sentinelRef} className="flex min-h-10 justify-center py-4">
                  {isFetchingNextPage ? (
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : !hasNextPage ? (
                    <span className="text-xs text-muted-foreground">You&apos;re all caught up</span>
                  ) : null}
                </div>
              </div>
            </div>
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

function EmptyState({
  copy,
  onClear,
  onCompose,
}: {
  copy: VoicesEmptyCopy;
  onClear: () => void;
  onCompose: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center" data-testid="voices-empty">
      <MessagesSquare className="h-10 w-10 text-muted-foreground/40" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{copy.title}</p>
        {copy.body ? (
          <p className="max-w-xs text-sm text-muted-foreground">{copy.body}</p>
        ) : null}
      </div>
      {copy.filtered ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-keep-composer-focus=""
            data-testid="voices-empty-clear"
            onPointerDown={(event) => {
              const decision = emptyStateClearGesture({
                type: "pointerdown",
                button: event.button,
              });
              if (!decision.clear) return;
              if (decision.preventFocusChange) event.preventDefault();
              onClear();
            }}
            onClick={() => {
              const decision = emptyStateClearGesture({ type: "click" });
              if (decision.clear) onClear();
            }}
          >
            Clear filters
          </Button>
          <Button type="button" size="sm" onClick={onCompose} data-testid="voices-empty-compose">
            Post the first take
          </Button>
        </div>
      ) : null}
    </div>
  );
}
