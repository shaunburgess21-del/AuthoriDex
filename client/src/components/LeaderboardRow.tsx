import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { RankBadge } from "./RankBadge";
import { Button } from "@/components/ui/button";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { useState, useEffect, useRef } from "react";
import { compactNumber, formatDelta, compactVotes } from "@/lib/formatNumber";
import { ThumbsUp, Star, Rocket, Zap, TrendingUp, TrendingDown, Flame } from "lucide-react";

const SEGMENT_COLORS_5 = [
  '#FF0000',
  '#FF9100',
  '#FFC400',
  '#76FF03',
  '#00C853',
];

const getRatingColor = (rating: number): string => {
  const idx = Math.max(0, Math.min(4, rating - 1));
  return SEGMENT_COLORS_5[idx];
};

const getApprovalColor = (approvalPct: number): string => {
  const normalizedPct = approvalPct <= 1 ? approvalPct * 100 : approvalPct;
  const rating = Math.round((normalizedPct / 100) * 4) + 1;
  const clampedRating = Math.max(1, Math.min(5, rating));
  return SEGMENT_COLORS_5[clampedRating - 1];
};

type LeaderboardTab = "fame" | "approval";

interface ExtendedPerson extends TrendingPerson {
  approvalPct?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  valueScore?: number | null;
  userValueVote?: string | null;
  leaderboardRank?: number;
  approvalVotesCount?: number | null;
  rankChange?: number | null;
}

interface LeaderboardRowProps {
  person: ExtendedPerson;
  activeTab?: LeaderboardTab;
  onVisitProfile: () => void;
  onVoteClick?: () => void;
  showExceptional?: boolean;
  thresholds?: PercentileThresholds;
}

interface PercentileThresholds {
  rankChangeP90: number;
  deltaP90: number;
  negRankChangeP10: number;
  negDeltaP10: number;
}

function computePercentileThresholds(people: ExtendedPerson[]): PercentileThresholds {
  const rankChanges = people.filter(p => p.rankChange != null).map(p => p.rankChange!);
  const deltas = people.filter(p => p.change24h != null).map(p => p.change24h!);

  const positiveRC = rankChanges.filter(v => v > 0).sort((a, b) => b - a);
  const positiveDeltas = deltas.filter(v => v > 0).sort((a, b) => b - a);
  const negativeRC = rankChanges.filter(v => v < 0).sort((a, b) => a - b);
  const negativeDeltas = deltas.filter(v => v < 0).sort((a, b) => a - b);

  const p5Index = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.05) - 1);
  const p10Index = (arr: number[]) => Math.max(0, Math.ceil(arr.length * 0.10) - 1);

  return {
    rankChangeP90: positiveRC.length > 0 ? positiveRC[p5Index(positiveRC)] : 999,
    deltaP90: positiveDeltas.length > 0 ? positiveDeltas[p5Index(positiveDeltas)] : 999,
    negRankChangeP10: negativeRC.length > 0 ? negativeRC[p10Index(negativeRC)] : -999,
    negDeltaP10: negativeDeltas.length > 0 ? negativeDeltas[p10Index(negativeDeltas)] : -999,
  };
}

function getExceptionalIndicator(
  person: ExtendedPerson,
  thresholds?: PercentileThresholds
): { icon: typeof Rocket; color: string; label: string; description: string; triggersHotMover: boolean } | null {
  const delta = person.change24h;
  const rankChange = person.rankChange;

  if (!thresholds) return null;

  const fmtDelta = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}%`;
  const fmtRank = (v: number) => `${v > 0 ? '+' : ''}${v}`;

  const metrics = `24h: ${delta != null ? fmtDelta(delta) : '—'} · Rank: ${rankChange != null ? fmtRank(rankChange) : '—'}`;

  if (rankChange != null && rankChange >= thresholds.rankChangeP90 && delta != null && delta >= thresholds.deltaP90) {
    return { icon: Rocket, color: "text-orange-400", label: "Breakout", description: `Big surge + big rank jump\n${metrics}`, triggersHotMover: true };
  }
  if (delta != null && delta >= thresholds.deltaP90) {
    return { icon: Flame, color: "text-yellow-400", label: "Surging", description: `Driver: Score spike\n${metrics}`, triggersHotMover: true };
  }
  if (rankChange != null && rankChange >= thresholds.rankChangeP90) {
    return { icon: Flame, color: "text-yellow-400", label: "Surging", description: `Driver: Rank jump\n${metrics}`, triggersHotMover: true };
  }
  if (delta != null && delta <= thresholds.negDeltaP10 && delta <= -3) {
    const hasRankDrop = rankChange != null && rankChange <= thresholds.negRankChangeP10;
    return { icon: TrendingDown, color: "text-sky-300", label: "Cooling", description: `${hasRankDrop ? 'Fading momentum + rank drop' : 'Fading momentum'}\n${metrics}`, triggersHotMover: false };
  }

  return null;
}

export { getExceptionalIndicator, computePercentileThresholds };
export type { PercentileThresholds };

const EVER_VOTED_KEY = "authoridex-has-ever-voted";

function getHasEverVoted(): boolean {
  try {
    return localStorage.getItem(EVER_VOTED_KEY) === "1";
  } catch {
    return false;
  }
}

function markEverVoted() {
  try {
    localStorage.setItem(EVER_VOTED_KEY, "1");
    window.dispatchEvent(new CustomEvent("authoridex-ever-voted"));
  } catch {}
}

export function LeaderboardRow({ person, activeTab = "fame", onVisitProfile, onVoteClick, showExceptional = true, thresholds }: LeaderboardRowProps) {
  const [sentimentScore, setSentimentScore] = useState<number | null>(null);
  const [hasEverVoted, setHasEverVoted] = useState(getHasEverVoted);

  useEffect(() => {
    const loadSentimentScore = () => {
      try {
        const savedVote = typeof window !== "undefined" ? localStorage.getItem(`sentiment-vote-${person.id}`) : null;
        if (savedVote) {
          const parsed = parseInt(savedVote, 10);
          setSentimentScore(Number.isFinite(parsed) ? parsed : null);
          if (!getHasEverVoted()) {
            markEverVoted();
          }
        } else {
          setSentimentScore(null);
        }
      } catch {
        setSentimentScore(null);
      }
    };

    loadSentimentScore();

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === `sentiment-vote-${person.id}`) {
        loadSentimentScore();
      }
    };

    const handleCustomUpdate = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.personId === person.id) {
        loadSentimentScore();
        if (!getHasEverVoted()) {
          markEverVoted();
        }
      }
    };

    const handleEverVoted = () => setHasEverVoted(true);

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('sentiment-vote-updated', handleCustomUpdate);
    window.addEventListener('authoridex-ever-voted', handleEverVoted);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sentiment-vote-updated', handleCustomUpdate);
      window.removeEventListener('authoridex-ever-voted', handleEverVoted);
    };
  }, [person.id]);

  const fameScore = (person as any).fameIndexLive ?? person.fameIndex ?? Math.round(person.trendScore / 100);
  const delta24h = formatDelta(person.change24h);
  const showDelta = person.change24h != null && Math.abs(person.change24h) >= 2;
  const exceptional = showExceptional ? getExceptionalIndicator(person, thresholds) : null;
  const ExceptionalIcon = exceptional?.icon;
  const hasVoted = sentimentScore !== null;
  const showVotePulse = !hasVoted && !hasEverVoted;

  const prevScoreRef = useRef(fameScore);
  const [scoreFlash, setScoreFlash] = useState(false);
  useEffect(() => {
    if (prevScoreRef.current !== fameScore) {
      prevScoreRef.current = fameScore;
      setScoreFlash(true);
      const t = setTimeout(() => setScoreFlash(false), 300);
      return () => clearTimeout(t);
    }
  }, [fameScore]);

  return (
    <div className="border-b">
      <div
        className="flex items-center gap-3 sm:gap-4 lg:gap-6 p-3 py-4 sm:p-4 sm:py-5 hover-elevate active-elevate-2 cursor-pointer"
        onClick={onVisitProfile}
        data-testid={`row-person-${person.id}`}
      >
        <RankBadge rank={person.leaderboardRank ?? (person as any).liveRank ?? person.rank} rankChange={person.rankChange} colorMode={activeTab} />
        <PersonAvatar name={person.name} avatar={person.avatar} imageSlug={(person as any).imageSlug} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-base truncate" data-testid={`text-name-${person.id}`}>
              {person.name}
            </h3>
            {exceptional && ExceptionalIcon && (
              <TouchTooltip
                content={
                  <>
                    <p className="font-semibold text-xs">{exceptional.label} — {exceptional.description.split('\n')[0]}</p>
                    {exceptional.description.includes('\n') && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{exceptional.description.split('\n')[1]}</p>
                    )}
                  </>
                }
                side="top"
                className="max-w-[220px] text-center"
              >
                <span className="inline-flex cursor-help" data-testid={`indicator-${exceptional.label.toLowerCase()}-${person.id}`}>
                  <ExceptionalIcon className={`h-3.5 w-3.5 shrink-0 ${exceptional.color}`} />
                </span>
              </TouchTooltip>
            )}
          </div>
          {person.category && (
            <p className="hidden md:block text-sm truncate text-[#94A3B8]">
              {person.category}
            </p>
          )}
          <p className="md:hidden text-xs text-muted-foreground leading-tight truncate">
            {activeTab === "fame" && (
              <span className="font-mono">
                {compactNumber(fameScore)}
                {showDelta && (
                  <span className={person.change24h! > 0 ? "text-emerald-400" : "text-red-400"}>
                    {' '}{delta24h}
                  </span>
                )}
              </span>
            )}
            {activeTab === "approval" && (
              <span>
                {person.approvalPct != null ? (
                  <>
                    <span
                      className="font-mono"
                      style={{ color: getApprovalColor(person.approvalPct) }}
                    >
                      {Math.round(person.approvalPct)}%
                    </span>
                    {person.approvalVotesCount != null && (
                      <span className="text-muted-foreground">
                        {' '}&middot; {compactVotes(person.approvalVotesCount)} votes
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">No votes yet</span>
                )}
              </span>
            )}
          </p>
        </div>

        {activeTab === "fame" && (
          <>
            <div className="text-right hidden sm:block w-[120px] shrink-0">
              <p className={`font-mono font-bold text-2xl tabular-nums ${scoreFlash ? 'number-flash' : ''}`} data-testid={`text-score-${person.id}`}>
                {fameScore.toLocaleString('en-US')}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Trend Score
              </p>
            </div>
            <div className="hidden lg:block text-right w-[72px] shrink-0" data-testid={`text-delta-desktop-${person.id}`}>
              <p className={`font-mono font-semibold text-sm tabular-nums ${
                person.change24h == null || Math.abs(person.change24h) < 0.05
                  ? "text-muted-foreground"
                  : person.change24h > 0
                    ? "text-emerald-400"
                    : "text-red-400"
              }`}>
                {person.change24h != null ? delta24h : '—'}
              </p>
            </div>
            <div className="hidden md:block text-right w-[72px] shrink-0">
              <TouchTooltip
                content={person.approvalPct != null ? `${person.name} has a ${Math.round(person.approvalPct)}% approval rating from community votes` : "No votes yet"}
                side="top"
              >
                <p className="font-mono font-semibold text-lg tabular-nums cursor-help" data-testid={`sentiment-score-${person.id}`}>
                  {person.approvalPct != null ? (
                    <span style={{ color: getApprovalColor(person.approvalPct) }}>
                      {Math.round(person.approvalPct)}%
                    </span>
                  ) : (
                    '—'
                  )}
                </p>
              </TouchTooltip>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Approval
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={`no-default-hover-elevate no-default-active-elevate gap-1 text-xs hover:bg-[#22D3EE]/20 hover:border-[#22D3EE]/40 hover:text-[#22D3EE] ${showVotePulse ? "vote-cta-pulse" : ""}`}
              aria-label={hasVoted ? `Rated ${person.name} ${sentimentScore}/5` : `Rate ${person.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-vote-icon-${person.id}`}
            >
              {hasVoted && sentimentScore != null ? (
                <>
                  <Star style={{ width: 14, height: 14, color: '#22D3EE' }} strokeWidth={1.5} />
                  <span className="font-mono font-bold text-xs" style={{ color: getRatingColor(sentimentScore) }}>{sentimentScore}/5</span>
                </>
              ) : (
                <>
                  <Star style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                  Rate
                </>
              )}
            </Button>
          </>
        )}

        {activeTab === "approval" && (
          <>
            <div className="text-right hidden sm:block w-[120px] shrink-0">
              <TouchTooltip
                content={`${person.name}'s approval rating from community votes`}
                side="top"
              >
                <p className="font-mono font-bold text-2xl tabular-nums cursor-help">
                  {person.approvalPct != null ? (
                    <span style={{ color: getApprovalColor(person.approvalPct) }}>
                      {Math.round(person.approvalPct)}%
                    </span>
                  ) : (
                    '—'
                  )}
                </p>
              </TouchTooltip>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Approval
              </p>
            </div>
            <div className="hidden md:block text-right w-[120px] shrink-0">
              <p className="font-mono font-bold text-xl tabular-nums text-muted-foreground">
                {fameScore.toLocaleString('en-US')}
              </p>
              <p className="text-xs text-muted-foreground uppercase tracking-wide lg:hidden">
                Trend Score
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={`no-default-hover-elevate no-default-active-elevate gap-1 text-xs hover:bg-[#22D3EE]/20 hover:border-[#22D3EE]/40 hover:text-[#22D3EE] ${showVotePulse ? "vote-cta-pulse" : ""}`}
              aria-label={hasVoted ? `Rated ${person.name} ${sentimentScore}/5` : `Rate ${person.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onVoteClick?.();
              }}
              data-testid={`button-vote-icon-${person.id}`}
            >
              {hasVoted && sentimentScore != null ? (
                <>
                  <Star style={{ width: 14, height: 14, color: '#22D3EE' }} strokeWidth={1.5} />
                  <span className="font-mono font-bold text-xs" style={{ color: getRatingColor(sentimentScore) }}>{sentimentScore}/5</span>
                </>
              ) : (
                <>
                  <Star style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                  Rate
                </>
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
