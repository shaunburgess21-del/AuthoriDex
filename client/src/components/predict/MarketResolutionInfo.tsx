import { Card } from "@/components/ui/card";
import { PredictDetailSectionHeader } from "./PredictDetailSectionHeader";
import {
  Shield,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Database,
  CheckCircle,
  Lock,
  Trophy,
  Swords,
  Zap,
} from "lucide-react";

/**
 * "How this resolves" card. One component, four flavours, so every
 * detail page (Up/Down, H2H, Race/Gainer, Community) tells users the
 * same story in the same shape.
 *
 * Up/Down used to own this card; H2H and Race each rolled their own
 * muted Card with subtly different bullet patterns. We unify them via
 * a `mode` prop so a notification deep-link lands users in the same
 * visual rhythm regardless of market type.
 */

export type MarketResolutionMode = "updown" | "h2h" | "race" | "community";

interface MarketResolutionInfoProps {
  mode?: MarketResolutionMode;
  /** Up/Down only — baseline trend score for UP/DOWN bullet copy. */
  baselineScore?: number;
  /** Up/Down only — when the baseline snapshot was taken. */
  baselineTimestamp?: string;
  /** Up/Down: results time. H2H/Race: market resolution time. */
  closeTime?: string;
  /** ISO date for weekly betting cutoff (Fri 23:59 UTC); falls back to label if missing */
  bettingCutoff?: string | null;
  /** "refund" | "up_wins" | "down_wins" — only meaningful for Up/Down + H2H. */
  tieRule?: string;
  resolveMethod?: string;
  /** Up/Down only — person being predicted on. */
  personName?: string;
  /** H2H only — both contenders. */
  person1Name?: string;
  person2Name?: string;
  /** Race only — category label (e.g. "Athletes", "Musicians"). */
  categoryLabel?: string;
  /** Community only — free-form criteria (single string or bullet list). */
  resolutionCriteria?: string | string[] | null;
  /**
   * Engine of the underlying market. AMM is the default verb
   * ("Trading closes"); jackpot keeps "Entries close" by passing
   * `"parimutuel"` explicitly.
   */
  engine?: "amm" | "parimutuel";
  compact?: boolean;
}

function normalizeCriteriaList(criteria?: string | string[] | null): string[] {
  if (!criteria) return [];
  if (typeof criteria === "string") {
    const trimmed = criteria.trim();
    return trimmed ? [trimmed] : [];
  }
  return criteria.map((c) => c.trim()).filter(Boolean);
}

function formatScore(n: number): string {
  return n.toLocaleString("en-US");
}

function formatTimestamp(ts?: string): string {
  if (!ts) return "Mon 00:00 UTC";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getUTCDay()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

/** Full UTC string matching market "closes" line, or null if invalid */
function formatBettingCutoffUtc(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toUTCString().replace(/ GMT$/, " UTC");
}

const BETTING_CUTOFF_FALLBACK = "Fri 23:59 UTC";

const TIE_RULE_LABELS: Record<string, string> = {
  refund: "All positions refunded",
  down_wins: "DOWN wins on exact tie",
  up_wins: "UP wins on exact tie",
};

const H2H_TIE_LABEL = "All positions refunded";

export function MarketResolutionInfo({
  mode = "updown",
  baselineScore = 0,
  baselineTimestamp,
  closeTime,
  bettingCutoff,
  tieRule = "refund",
  resolveMethod,
  personName,
  person1Name,
  person2Name,
  categoryLabel,
  resolutionCriteria,
  engine = "amm",
  compact = false,
}: MarketResolutionInfoProps) {
  const tieLabel = TIE_RULE_LABELS[tieRule] || "All positions refunded";
  const communityCriteria = normalizeCriteriaList(resolutionCriteria);
  const resolutionLabel =
    mode === "community"
      ? resolveMethod === "admin_manual"
        ? "Resolved by admin from listed sources"
        : "Settled from the market's resolution criteria"
      : resolveMethod === "admin_manual"
        ? "Admin resolution"
        : "Auto-calculated from VoxDex trend engine";
  const predictionsCloseLabel = formatBettingCutoffUtc(bettingCutoff) ?? BETTING_CUTOFF_FALLBACK;
  const resultsLabel = closeTime || "Sun 23:59 UTC";
  const isAmm = engine === "amm";
  const closeLabelVerb = isAmm ? "Trading closes" : "Entries close";

  const Bullets = (() => {
    if (mode === "h2h") {
      const a = person1Name || "Side A";
      const b = person2Name || "Side B";
      return (
        <>
          <Bullet icon={<TrendingUp className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}>
            <span>
              <span className="font-medium text-foreground">{a}</span> wins if their final Trend Score is higher
            </span>
          </Bullet>
          <Bullet icon={<TrendingDown className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />}>
            <span>
              <span className="font-medium text-foreground">{b}</span> wins if their final Trend Score is higher
            </span>
          </Bullet>
          <Bullet icon={<Swords className="h-3.5 w-3.5" />}>
            <span>Exact tie: {(tieRule === "refund" ? H2H_TIE_LABEL : tieLabel).toLowerCase()}</span>
          </Bullet>
        </>
      );
    }
    if (mode === "race") {
      const cat = categoryLabel ? ` in ${categoryLabel}` : "";
      return (
        <>
          <Bullet icon={<TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />}>
            <span>
              Winner is whoever has the highest{" "}
              <span className="font-medium text-foreground">% gain</span> in their Trend Score by close{cat}.
            </span>
          </Bullet>
          <Bullet icon={<Zap className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500" />}>
            <span>Biggest mover wins &mdash; not the highest ranked.</span>
          </Bullet>
        </>
      );
    }
    if (mode === "community") {
      return (
        <>
          {communityCriteria.length > 0 ? (
            communityCriteria.map((criterion, i) => (
              <Bullet key={i} icon={<CheckCircle className="h-3.5 w-3.5 text-violet-500" />}>
                <span>{criterion}</span>
              </Bullet>
            ))
          ) : (
            <Bullet icon={<CheckCircle className="h-3.5 w-3.5 text-violet-500" />}>
              <span>Resolves based on the market description and listed sources.</span>
            </Bullet>
          )}
          <Bullet icon={<RefreshCw className="h-3.5 w-3.5" />}>
            <span>Void = all positions refunded</span>
          </Bullet>
        </>
      );
    }
    // Default: updown
    const name = personName || "Subject";
    return (
      <>
        <Bullet icon={<Database className="h-3.5 w-3.5" />}>
          <span>
            Baseline Score:{" "}
            <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span>
            {baselineTimestamp && (
              <span className="text-muted-foreground"> at {formatTimestamp(baselineTimestamp)}</span>
            )}
          </span>
        </Bullet>
        <Bullet icon={<TrendingUp className="h-3.5 w-3.5 text-green-500" />}>
          <span>
            UP wins if {name} closes above{" "}
            <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span>
          </span>
        </Bullet>
        <Bullet icon={<TrendingDown className="h-3.5 w-3.5 text-red-500" />}>
          <span>
            DOWN wins if {name} closes below{" "}
            <span className="font-mono font-medium text-foreground">{formatScore(baselineScore)}</span>
          </span>
        </Bullet>
        <Bullet icon={<RefreshCw className="h-3.5 w-3.5" />}>
          <span>Exact tie: {tieLabel.toLowerCase()}</span>
        </Bullet>
      </>
    );
  })();

  if (compact) {
    return (
      <div className="text-[11px] text-muted-foreground space-y-0.5 leading-snug">
        <p>
          <Lock className="inline h-3 w-3 text-amber-500 mr-1" />
          {closeLabelVerb}: <span className="font-medium text-foreground">{predictionsCloseLabel}</span>
        </p>
        <p>
          <Trophy className="inline h-3 w-3 text-violet-500 mr-1" />
          Results: <span className="font-medium text-foreground">{resultsLabel}</span>
        </p>
        {mode === "updown" && (() => {
          const name = personName || "Subject";
          return (
            <>
              <p>
                <TrendingUp className="inline h-3 w-3 text-green-500 mr-1" />
                UP wins if {name} closes above {formatScore(baselineScore)}
              </p>
              <p>
                <TrendingDown className="inline h-3 w-3 text-red-500 mr-1" />
                DOWN wins if {name} closes below {formatScore(baselineScore)}
              </p>
              <p>
                <RefreshCw className="inline h-3 w-3 mr-1" />
                Exact tie: {tieLabel.toLowerCase()}
              </p>
            </>
          );
        })()}
        {mode === "h2h" && (
          <>
            <p>
              <TrendingUp className="inline h-3 w-3 text-blue-500 mr-1" />
              {(person1Name || "Side A")} wins if their final Trend Score is higher
            </p>
            <p>
              <TrendingDown className="inline h-3 w-3 text-purple-500 mr-1" />
              {(person2Name || "Side B")} wins if their final Trend Score is higher
            </p>
          </>
        )}
        {mode === "race" && (
          <p>
            <TrendingUp className="inline h-3 w-3 text-green-500 mr-1" />
            Highest % gain in Trend Score by close wins.
          </p>
        )}
        {mode === "community" && (
          <>
            {communityCriteria.length > 0 ? (
              communityCriteria.map((criterion, i) => (
                <p key={i}>
                  <CheckCircle className="inline h-3 w-3 text-violet-500 mr-1" />
                  {criterion}
                </p>
              ))
            ) : (
              <p>
                <CheckCircle className="inline h-3 w-3 text-violet-500 mr-1" />
                Resolves based on the market description and listed sources.
              </p>
            )}
            <p>
              <RefreshCw className="inline h-3 w-3 mr-1" />
              Void = all positions refunded
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <Card className="border-border/50 shadow-none">
      <div className="p-4 sm:p-5">
        <PredictDetailSectionHeader
          icon={Shield}
          title="How this resolves"
          subtitle="Trading cutoff, results time, and winner rules"
          accent="predict"
        />
        <div className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <Bullet icon={<Lock className="h-3.5 w-3.5 text-amber-500" />}>
            <span>
              {closeLabelVerb}: <span className="font-medium text-foreground">{predictionsCloseLabel}</span>
            </span>
          </Bullet>
          <Bullet icon={<Trophy className="h-3.5 w-3.5 text-violet-500" />}>
            <span>
              Results: <span className="font-medium text-foreground">{resultsLabel}</span>
            </span>
          </Bullet>
          {Bullets}
          <Bullet icon={<CheckCircle className="h-3.5 w-3.5 text-violet-500" />}>
            <span>{resolutionLabel}</span>
          </Bullet>
        </div>
      </div>
    </Card>
  );
}

function Bullet({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">{icon}</span>
      {children}
    </div>
  );
}
