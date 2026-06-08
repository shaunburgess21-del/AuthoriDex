import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  Flame,
  Minus,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Vote,
  LineChart as LineChartIcon,
} from "lucide-react";
import { useInsightsOverview } from "@/lib/insights-hooks";
import { PersonAvatar } from "@/components/PersonAvatar";
import { PersonInsightModal, type InsightPerson } from "@/components/PersonInsightModal";
import { Skeleton } from "@/components/ui/skeleton";
import { buildBriefingDisplayHeadlines } from "@shared/insights/briefing-headlines";
import { writeInsightsQuery } from "@shared/insights/filters";
import type { InsightsWindow, InsightsSource } from "@shared/insights/filters";
import type {
  InsightsFavouriteHighlight,
  InsightsFavouritesSignals,
  InsightsPrimaryDriver,
} from "@shared/insights/types";
import { logInsightsEvent } from "@/lib/insights-telemetry";
import { useAuth } from "@/contexts/AuthContext";
import {
  InsightsSection,
  DRIVER_DISPLAY,
  InsightsEmptyState,
} from "./insights-ui";
import { CategoryPill } from "@/components/CategoryPill";
import { Button } from "@/components/ui/button";
import { navigateToLogin } from "@/lib/authReturn";
import {
  getInsightsTabCardClass,
  INSIGHTS_ATTENTION_MIX_ENABLED,
  INSIGHTS_DRIVER_LEGEND,
} from "@shared/insights/constants";
import { cn } from "@/lib/utils";

/** Strip combining diacritical marks so "Mbappé" matches a stored "Mbappe". */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function buildNormalized(text: string): { normalized: string; map: number[] } {
  let normalized = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const norm = stripDiacritics(text[i]!).toLowerCase();
    for (let j = 0; j < norm.length; j++) {
      normalized += norm[j];
      map.push(i);
    }
  }
  return { normalized, map };
}

/**
 * Linkify any `people` names found in `text`, accent- and case-insensitively,
 * while rendering the original spelling. Longest names win on overlap.
 */
function linkifyBriefingText(
  text: string,
  people: Array<{ id: string; name: string }>,
): ReactNode[] {
  if (people.length === 0) return [text];

  const { normalized, map } = buildNormalized(text);
  const candidates = people
    .map((p) => ({ person: p, norm: stripDiacritics(p.name).toLowerCase() }))
    .filter((c) => c.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length);

  const nodes: ReactNode[] = [];
  let normPos = 0;
  let origPos = 0;
  let key = 0;

  while (normPos < normalized.length) {
    let best: { idx: number; len: number; person: { id: string; name: string } } | null = null;
    for (const c of candidates) {
      const idx = normalized.indexOf(c.norm, normPos);
      if (idx !== -1 && (best === null || idx < best.idx)) {
        best = { idx, len: c.norm.length, person: c.person };
      }
    }
    if (!best) break;

    const origStart = map[best.idx]!;
    const origEnd = map[best.idx + best.len - 1]! + 1;

    if (origStart > origPos) nodes.push(text.slice(origPos, origStart));
    nodes.push(
      <Link
        key={`${best.person.id}-${key++}`}
        href={`/person/${best.person.id}`}
        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
      >
        {text.slice(origStart, origEnd)}
      </Link>,
    );

    normPos = best.idx + best.len;
    origPos = origEnd;
  }

  if (origPos < text.length) nodes.push(text.slice(origPos));
  return nodes;
}

function BriefingBody({
  paragraphs,
  body,
  people,
}: {
  paragraphs?: string[];
  body: string;
  people?: Array<{ id: string; name: string }>;
}) {
  const blocks = paragraphs?.length ? paragraphs : [body];
  const linkPeople = people ?? [];

  return (
    <div className="mt-2 space-y-3">
      {blocks.map((paragraph, i) => (
        <p key={i} className="text-sm text-muted-foreground leading-relaxed">
          {linkifyBriefingText(paragraph, linkPeople)}
        </p>
      ))}
    </div>
  );
}

function MoversWindowToggle({
  value,
  onChange,
}: {
  value: InsightsWindow;
  onChange: (window: InsightsWindow) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-border/50 bg-muted/40 p-0.5 text-[11px] font-medium"
      role="group"
      aria-label="Movers time window"
    >
      {(["24h", "7d"] as const).map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
          onClick={() => onChange(w)}
          className={cn(
            "px-3 py-1.5 rounded-md transition-colors tabular-nums",
            value === w
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

interface MoverItem {
  id: string;
  name: string;
  avatar: string | null;
  category: string | null;
  change24h: number | null;
  change7d: number | null;
  rank: number;
}

function MoverList({
  items,
  positive,
  window,
  onSelect,
}: {
  items: MoverItem[];
  positive: boolean;
  window: InsightsWindow;
  onSelect: (item: MoverItem) => void;
}) {
  const changeField = window === "24h" ? "change24h" : "change7d";
  const emptyMessage =
    window === "24h"
      ? positive
        ? "No climbers in the last 24 hours."
        : "No droppers in the last 24 hours."
      : positive
        ? "No climbers this week."
        : "No droppers this week.";

  if (items.length === 0) {
    return <InsightsEmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-1.5">
      {items.map((m) => {
        const change = m[changeField] ?? 0;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(m)}
            className="w-full flex items-center gap-2.5 text-sm p-2.5 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors text-left"
          >
            <span className="text-[10px] font-mono text-muted-foreground w-6">#{m.rank}</span>
            <PersonAvatar name={m.name} avatar={m.avatar} size="xs" />
            <span className="truncate flex-1 font-medium">{m.name}</span>
            <span
              className={`tabular-nums text-xs font-semibold ${positive ? "text-green-600 dark:text-green-400" : "text-red-500"}`}
            >
              {positive ? "+" : ""}
              {change.toFixed(1)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Gradient per driver so the Attention mix reads at a glance. */
const DRIVER_BAR_GRADIENT: Record<InsightsPrimaryDriver, string> = {
  NEWS: "from-blue-600/80 to-blue-400/60",
  WIKI: "from-purple-600/80 to-purple-400/60",
  SEARCH: "from-amber-500/80 to-amber-300/60",
  MIXED: "from-slate-500/70 to-slate-400/50",
};

/** Drivers that map cleanly to a ranking source (MIXED has no single source). */
const DRIVER_TO_SOURCE: Partial<Record<InsightsPrimaryDriver, InsightsSource>> = {
  NEWS: "news_momentum",
  WIKI: "wiki_momentum",
  SEARCH: "search_volume",
};

function FavouriteHighlightRow({ item }: { item: InsightsFavouriteHighlight }) {
  const change = item.change24h;

  return (
    <Link
      href={`/person/${item.personId}`}
      className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-background/50 hover:bg-muted/40 transition-colors"
    >
      <PersonAvatar name={item.name} avatar={item.avatar} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm truncate">{item.name}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          {item.category && <CategoryPill category={item.category} size="sm" />}
          <span className="text-[10px] text-muted-foreground tabular-nums">#{item.rank}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0 tabular-nums text-sm font-semibold">
        {change > 0 ? (
          <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : change < 0 ? (
          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
        ) : (
          <Minus className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span
          className={cn(
            change > 0 && "text-green-600 dark:text-green-400",
            change < 0 && "text-red-500",
            change === 0 && "text-muted-foreground",
          )}
        >
          {change > 0 ? "+" : ""}
          {change.toFixed(1)}%
        </span>
      </div>
    </Link>
  );
}

function FavouriteHeroCard({ item }: { item: InsightsFavouriteHighlight }) {
  const up = item.change24h > 0;
  const down = item.change24h < 0;
  const changeAbs = Math.abs(item.change24h);

  return (
    <Link
      href={`/person/${item.personId}`}
      className="group relative block overflow-hidden rounded-lg border border-border/60 bg-gradient-to-br from-blue-500/[0.06] via-background to-background hover:from-blue-500/[0.08] transition-colors"
      data-testid="favourites-hero-card"
    >
      <div className="absolute inset-y-0 right-0 w-1/2 opacity-[0.04] pointer-events-none">
        <div className="h-full w-full bg-gradient-to-l from-blue-500/40 to-transparent" />
      </div>

      <div className="relative p-4 flex items-start gap-3">
        <div className="relative shrink-0">
          <PersonAvatar name={item.name} avatar={item.avatar} size="md" />
          <div className="absolute -bottom-1 -right-1 rounded-full bg-background border border-border/60 p-0.5">
            <Flame className="h-3 w-3 text-orange-500" />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">
            Biggest mover · 24h
          </p>
          <p className="text-base md:text-lg font-semibold truncate mt-0.5 group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {item.name}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {item.category && <CategoryPill category={item.category} size="sm" />}
            <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
              #{item.rank}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums",
                up && "text-green-600 dark:text-green-400",
                down && "text-red-500",
                !up && !down && "text-muted-foreground",
              )}
            >
              {up && <TrendingUp className="h-3.5 w-3.5" />}
              {down && <TrendingDown className="h-3.5 w-3.5" />}
              {!up && !down && <Minus className="h-3.5 w-3.5" />}
              {up ? "+" : down ? "-" : ""}
              {changeAbs.toFixed(1)}%
            </span>
          </div>
        </div>

        <ArrowRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground transition-colors hidden sm:block" />
      </div>
    </Link>
  );
}

function FavouriteActivityStrip({
  pendingMarketsCount,
  pendingPollsCount,
}: {
  pendingMarketsCount: number;
  pendingPollsCount: number;
}) {
  if (pendingMarketsCount === 0 && pendingPollsCount === 0) return null;

  return (
    <Link
      href="/me/favorites"
      className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/30 hover:bg-muted/50 px-3 py-2 transition-colors"
      data-testid="favourites-activity-strip"
    >
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {pendingMarketsCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <LineChartIcon className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-foreground font-medium tabular-nums">{pendingMarketsCount}</span>
            <span>{pendingMarketsCount === 1 ? "live market" : "live markets"}</span>
          </span>
        )}
        {pendingMarketsCount > 0 && pendingPollsCount > 0 && (
          <span className="text-muted-foreground/40">·</span>
        )}
        {pendingPollsCount > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Vote className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-foreground font-medium tabular-nums">{pendingPollsCount}</span>
            <span>{pendingPollsCount === 1 ? "active vote" : "active votes"}</span>
          </span>
        )}
      </div>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
    </Link>
  );
}

function FavouritesPanel({
  isLoggedIn,
  favouritesSignals,
}: {
  isLoggedIn: boolean;
  favouritesSignals?: InsightsFavouritesSignals;
}) {
  const [, setLocation] = useLocation();

  if (!isLoggedIn) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-5 text-center">
        <Star className="h-8 w-8 mx-auto mb-2 text-muted-foreground/70" />
        <p className="text-sm font-medium">Sign in to track favourites</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
          Favourite people on the leaderboard and see how they&apos;re moving here.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button size="sm" onClick={() => navigateToLogin(setLocation)}>
            Sign in
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLocation("/")}>
            Browse leaderboard
          </Button>
        </div>
      </div>
    );
  }

  if (!favouritesSignals || favouritesSignals.favouriteCount === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-5 text-center">
        <Star className="h-8 w-8 mx-auto mb-2 text-muted-foreground/70" />
        <p className="text-sm font-medium">No favourites yet</p>
        <p className="text-xs text-muted-foreground mt-1 mb-4 leading-relaxed">
          Tap the heart on anyone in the leaderboard to track them here.
        </p>
        <Button size="sm" variant="outline" onClick={() => setLocation("/")}>
          Browse leaderboard
        </Button>
      </div>
    );
  }

  const hero = favouritesSignals.highlights[0];
  const restHighlights = favouritesSignals.highlights.slice(1);

  if (favouritesSignals.highlights.length === 0) {
    // No 24h movement, but the user has favourites — still show activity if any.
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Your {favouritesSignals.favouriteCount}{" "}
          {favouritesSignals.favouriteCount === 1 ? "favourite is" : "favourites are"} steady today
          — no big 24h moves yet.
        </p>
        <FavouriteActivityStrip
          pendingMarketsCount={favouritesSignals.pendingMarketsCount}
          pendingPollsCount={favouritesSignals.pendingPollsCount}
        />
        <Link
          href="/me/favorites"
          className="inline-block text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          View full watchlist →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hero && <FavouriteHeroCard item={hero} />}
      {restHighlights.length > 0 && (
        <ul className="space-y-2">
          {restHighlights.map((h) => (
            <li key={h.personId}>
              <FavouriteHighlightRow item={h} />
            </li>
          ))}
        </ul>
      )}
      <FavouriteActivityStrip
        pendingMarketsCount={favouritesSignals.pendingMarketsCount}
        pendingPollsCount={favouritesSignals.pendingPollsCount}
      />
      <Link
        href="/me/favorites"
        className="inline-block text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        View full watchlist →
      </Link>
    </div>
  );
}

function moverToInsightPerson(m: MoverItem): InsightPerson {
  return {
    id: m.id,
    name: m.name,
    avatar: m.avatar,
    category: m.category,
    rank: m.rank ?? null,
    change24h: m.change24h ?? null,
    rankChange: null,
    hotMover: false,
  };
}

export function OverviewTab() {
  const { isLoggedIn } = useAuth();
  const { data, isLoading, isError } = useInsightsOverview();
  const [moversWindow, setMoversWindow] = useState<InsightsWindow>("24h");
  const [selectedMover, setSelectedMover] = useState<InsightPerson | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="text-sm text-destructive">Could not load overview. Try again shortly.</p>;
  }

  const { story, movers, favouritesSignals } = data;
  const windowMovers = movers[moversWindow] ?? { climbers: [], droppers: [] };

  // Mover line: live 24h climber. Anchor line: cached lead anchor (twice daily).
  const liveLeader = movers["24h"]?.climbers[0];
  const briefingHeadlines = buildBriefingDisplayHeadlines({
    liveMover: liveLeader ? { id: liveLeader.id, name: liveLeader.name } : null,
    // people[] is anchors-then-movers; use as fallback until cache picks up leadAnchor.
    leadAnchor: story.leadAnchor ?? story.people?.[0] ?? null,
    fallbackHeadline: story.headline,
  });

  return (
    <div className="space-y-6 md:space-y-8">
      <section className={cn("relative overflow-hidden rounded-xl", getInsightsTabCardClass("today"))}>
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-500/15 p-2 shrink-0">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                Today&apos;s Briefing
              </p>
              {briefingHeadlines.length > 0 && (
                <div className="mt-1 space-y-0.5" aria-label="Briefing headlines">
                  {briefingHeadlines.map((line, index) => (
                    <p
                      key={line}
                      className={cn(
                        "text-sm md:text-base leading-snug",
                        index === 0 ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              )}
              <BriefingBody
                paragraphs={story.paragraphs}
                body={story.body}
                people={story.people}
              />

              <p className="text-[10px] text-muted-foreground/70 mt-3">
                {story.mode === "ai" ? "AI-summarized" : "Auto-generated"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        <InsightsSection
          tab="today"
          title="Movers"
          description={
            moversWindow === "24h"
              ? "Biggest 24-hour climbers and droppers on the leaderboard."
              : "Biggest 7-day climbers and droppers on the leaderboard."
          }
          action={<MoversWindowToggle value={moversWindow} onChange={setMoversWindow} />}
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingUp className="h-3.5 w-3.5 text-green-600" /> Climbers
              </p>
              <MoverList
                items={windowMovers.climbers.slice(0, 8)}
                positive
                window={moversWindow}
                onSelect={(m) => setSelectedMover(moverToInsightPerson(m))}
              />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingDown className="h-3.5 w-3.5 text-red-500" /> Droppers
              </p>
              <MoverList
                items={windowMovers.droppers.slice(0, 8)}
                positive={false}
                window={moversWindow}
                onSelect={(m) => setSelectedMover(moverToInsightPerson(m))}
              />
            </div>
          </div>
        </InsightsSection>

        <InsightsSection
          tab="today"
          title="Your favourites"
          description={
            isLoggedIn
              ? "How the people you follow are moving today."
              : "Sign in to see movement from people you track."
          }
        >
          <FavouritesPanel isLoggedIn={isLoggedIn} favouritesSignals={favouritesSignals} />
        </InsightsSection>
      </div>

      {INSIGHTS_ATTENTION_MIX_ENABLED && (
      <InsightsSection
        tab="today"
        title="Attention mix"
        description={`Of the top ${data.driverMix.topN}, the share of Trend Score movement driven by each signal.`}
      >
        <div className="space-y-3 max-w-2xl">
          {(() => {
            // The backend returns only the two real Trend Score drivers — News
            // and Wikipedia — already summing to 100% (Search carries 0 weight
            // in the velocity composite, so it's excluded). No re-normalisation
            // needed; the bars reflect actual contribution shares.
            if (data.driverMix.segments.length === 0) {
              return (
                <p className="text-sm text-muted-foreground">
                  Not enough signal data to break down attention right now.
                </p>
              );
            }
            return data.driverMix.segments.map((seg) => {
              const sharePct = seg.pct;
              const source = DRIVER_TO_SOURCE[seg.driver];
              const barInner = (
                <>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span
                      className={cn(
                        "font-medium transition-colors",
                        source && "group-hover:text-blue-600 dark:group-hover:text-blue-400",
                      )}
                    >
                      {DRIVER_DISPLAY[seg.driver] ?? seg.driver}
                    </span>
                    <span className="text-muted-foreground tabular-nums">{sharePct}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-muted/80 overflow-hidden">
                    <div
                      className={cn(
                        "h-full bg-gradient-to-r transition-all",
                        DRIVER_BAR_GRADIENT[seg.driver] ?? DRIVER_BAR_GRADIENT.MIXED,
                      )}
                      style={{ width: `${Math.max(sharePct, 2)}%` }}
                    />
                  </div>
                </>
              );

              return source ? (
                <button
                  key={seg.driver}
                  type="button"
                  className="w-full text-left group"
                  title={`Open ${DRIVER_DISPLAY[seg.driver]} rankings`}
                  onClick={() => {
                    logInsightsEvent("overview", "driver_slice_click", { driver: seg.driver });
                    writeInsightsQuery({ tab: "rankings", filters: { source } });
                  }}
                >
                  {barInner}
                </button>
              ) : (
                <div key={seg.driver} className="w-full">
                  {barInner}
                </div>
              );
            });
          })()}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/80">
          {(["NEWS", "WIKI"] as const).map((driver, i, arr) => (
            <span key={driver}>
              <span className="font-medium text-muted-foreground">{DRIVER_DISPLAY[driver]}</span>
              {" = "}
              {INSIGHTS_DRIVER_LEGEND[driver]}
              {i < arr.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
      </InsightsSection>
      )}

      <PersonInsightModal person={selectedMover} onClose={() => setSelectedMover(null)} />
    </div>
  );
}
