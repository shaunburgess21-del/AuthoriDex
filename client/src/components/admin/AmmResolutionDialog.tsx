/**
 * Shared resolve / void confirmation modal used by both the Settlement
 * Center and the AMM admin tab.
 *
 * Extracted from `AdminSettlementCenter.tsx` (Phase 5) so the AMM
 * Markets sub-tab can fire the same well-tested resolve / void flow
 * without duplicating the modal. Behaviour is identical to the
 * original — engine-aware URL switching for parimutuel vs AMM, and
 * a payout-preview side-panel for parimutuel markets.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CURRENCY } from "@/lib/currency";
import { useIsMobile } from "@/hooks/use-mobile";
import { isOtherStyleOutcomeLabel } from "@shared/lib/other-outcome";
import {
  isDrawStyleOutcomeLabel,
  isSingleWinnerKnockoutMarket,
  knockoutHintsFromMarket,
} from "@shared/lib/knockout-market";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Gavel,
  Loader2,
  Users,
  Coins,
  CheckCircle,
  XCircle,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/lib/supabase";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = await getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { "Content-Type": "application/json" };
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(url, { ...options, headers: { ...headers, ...options.headers }, credentials: "include" });
}

/** AI resolution-scout assessment, persisted in market metadata while the
 *  market was OPEN. Surfaced here so the operator sees the AI's last read
 *  when settling. Advisory only — the human always confirms. */
export interface ScoutAssessmentView {
  leaning?: string;
  proposedWinnerEntryId?: string | null;
  confidence?: number;
  stage?: "watch" | "likely" | "near_certain" | "met" | string;
  recommendedAction?: "none" | "watch" | "resolve_soon" | "resolve_now" | string;
  whatChanged?: string;
  sources?: string[];
  assessedAt?: string;
}

export interface ResolvableMarket {
  id: string;
  title: string;
  marketType: string;
  /** Phase 4: 'amm' markets resolve via the LMSR settlement endpoint. */
  engine?: "parimutuel" | "amm" | string | null;
  pool?: number;
  uniqueBettors?: number;
  entries: Array<{ id: string; label: string; marketId?: string }>;
  /** Optional AI scout assessment from when the market was open. */
  scoutAssessment?: ScoutAssessmentView | null;
  /** Admin-facing resolution criteria bullets (GPT summary or manual). */
  resolutionCriteria?: string[] | null;
  /** Verbatim upstream (Polymarket) rules prose from metadata.source. */
  sourceRulesText?: string | null;
  /** Upstream event URL for the operator to verify. */
  sourceUrl?: string | null;
  category?: string | null;
  /**
   * Market metadata — used to detect single-winner knockout markets
   * (Draw must not be selectable as the winner).
   */
  metadata?: unknown;
}

interface ResolutionPreview {
  marketId: string;
  title: string;
  totalPool: number;
  totalBets: number;
  uniqueBettors: number;
  entries: Array<{
    entryId: string;
    entryLabel: string;
    totalStaked: number;
    betCount: number;
    winnersCount: number;
    losersCount: number;
    totalPayouts: number;
    remainder: number;
    payoutDetails: Array<{ userId: string; username: string; stake: number; payout: number }>;
  }>;
}

function MarketTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    jackpot: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    community: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    updown: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    h2h: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    gainer: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
  };
  return (
    <Badge variant="outline" className={`text-xs border-0 ${colors[type] || ""}`}>
      {type === "h2h" ? "H2H" : type === "updown" ? "Up/Down" : type.charAt(0).toUpperCase() + type.slice(1)}
    </Badge>
  );
}

function ResolutionRulesPanel({
  criteria,
  sourceRulesText,
  sourceUrl,
}: {
  criteria?: string[] | null;
  sourceRulesText?: string | null;
  sourceUrl?: string | null;
}) {
  const bullets = Array.isArray(criteria) ? criteria.filter((c) => typeof c === "string" && c.trim()) : [];
  const hasRules = bullets.length > 0 || !!sourceRulesText || !!sourceUrl;
  if (!hasRules) return null;

  return (
    <details className="rounded-md border border-border bg-muted/30 p-3 group">
      <summary className="text-sm font-medium cursor-pointer list-none flex items-center justify-between gap-2">
        <span>Resolution rules</span>
        <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
        <span className="text-xs text-muted-foreground hidden group-open:inline">Hide</span>
      </summary>
      <div className="mt-3 space-y-3">
        {bullets.length > 0 ? (
          <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
            {bullets.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : null}
        {sourceRulesText ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Upstream rules (verbatim)</p>
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground max-h-48 overflow-y-auto rounded border border-border/60 bg-background/50 p-2">
              {sourceRulesText}
            </pre>
          </div>
        ) : null}
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 break-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {sourceUrl}
          </a>
        ) : null}
      </div>
    </details>
  );
}

const SCOUT_ACTION_LABEL: Record<string, string> = {
  resolve_now: "Resolve now",
  resolve_soon: "Resolve soon",
  watch: "Watch",
  none: "No action",
};

const SCOUT_STAGE_LABEL: Record<string, string> = {
  met: "Condition met",
  near_certain: "Near-certain",
  likely: "Likely",
  watch: "Watch",
};

function ScoutPanel({
  scout,
  proposedEntryLabel,
  onUseProposed,
  suggestVoid,
  onSuggestVoid,
}: {
  scout: ScoutAssessmentView;
  /** Label of the proposed winner entry when it maps to a real outcome. */
  proposedEntryLabel?: string | null;
  /** One-tap select of the scout's proposed winner (mobile-friendly). */
  onUseProposed?: () => void;
  /** Upstream closed with no mappable winner — scout leans void. */
  suggestVoid?: boolean;
  onSuggestVoid?: () => void;
}) {
  const conf =
    typeof scout.confidence === "number"
      ? `${Math.round(scout.confidence * 100)}%`
      : null;
  const actionLabel = scout.recommendedAction
    ? SCOUT_ACTION_LABEL[scout.recommendedAction] ?? scout.recommendedAction
    : null;
  const stageLabel = scout.stage
    ? SCOUT_STAGE_LABEL[scout.stage] ?? scout.stage
    : null;
  const urgent =
    scout.recommendedAction === "resolve_now" || scout.stage === "met";
  const assessedAt = scout.assessedAt
    ? new Date(scout.assessedAt).toLocaleString()
    : null;

  return (
    <div
      className={`rounded-md border p-3 space-y-2 ${
        urgent
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-sky-500/30 bg-sky-500/10"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <span className="text-sm font-medium">AI Scout assessment</span>
        {actionLabel && (
          <Badge
            variant="outline"
            className={`text-xs border-0 ${
              urgent
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                : "bg-sky-500/15 text-sky-700 dark:text-sky-300"
            }`}
          >
            {actionLabel}
          </Badge>
        )}
      </div>

      <div className="text-sm">
        <span className="text-muted-foreground">Suggests: </span>
        <span className="font-medium">{scout.leaning || "Unclear"}</span>
        {conf ? <span className="text-muted-foreground"> · {conf} confidence</span> : null}
        {stageLabel ? <span className="text-muted-foreground"> · {stageLabel}</span> : null}
      </div>

      {scout.whatChanged ? (
        <p className="text-sm text-muted-foreground">{scout.whatChanged}</p>
      ) : null}

      {Array.isArray(scout.sources) && scout.sources.length > 0 ? (
        <div className="flex flex-col gap-1">
          {scout.sources.slice(0, 4).map((src, i) => (
            <a
              key={`${src}-${i}`}
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1 break-all"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              {src}
            </a>
          ))}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        Advisory only — verify against the sources before resolving.
        {assessedAt ? ` Assessed ${assessedAt}.` : ""}
      </p>

      {proposedEntryLabel && onUseProposed ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full h-10 border-sky-500/40 text-sky-700 dark:text-sky-300"
          onClick={onUseProposed}
          data-testid="button-use-proposed-winner"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Use proposed winner: {proposedEntryLabel}
        </Button>
      ) : null}

      {suggestVoid && onSuggestVoid ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full h-10 border-destructive/40 text-destructive"
          onClick={onSuggestVoid}
          data-testid="button-scout-suggest-void"
        >
          <XCircle className="h-4 w-4 mr-2" />
          Scout suggests voiding — open void form
        </Button>
      ) : null}
    </div>
  );
}

export function AmmResolutionDialog({
  market,
  open,
  onOpenChange,
  /**
   * Extra invalidation keys for callers outside the Settlement Center
   * (e.g. the AMM admin tab needs `/api/admin/amm/markets`,
   * `/api/admin/amm/house`, `/api/admin/amm/trades` to refresh after a
   * resolve / void). Defaults cover the Settlement Center surface.
   */
  invalidateOnSettle = [],
}: {
  market: ResolvableMarket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalidateOnSettle?: Array<readonly unknown[]>;
}) {
  const queryClient = useQueryClient();
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  const isAmm = market.engine === "amm";
  const knockoutHints = knockoutHintsFromMarket(
    {
      title: market.title,
      category: market.category,
      metadata: market.metadata,
    },
    market.entries.map((e) => e.label),
  );
  const singleWinnerKnockout = isSingleWinnerKnockoutMarket(
    market.metadata,
    knockoutHints,
  );

  const scout = market.scoutAssessment ?? null;
  const scoutProposedEntry =
    scout?.proposedWinnerEntryId &&
    market.entries.some((e) => e.id === scout.proposedWinnerEntryId) &&
    // Never pre-select Draw on a knockout even if a stale assessment named it.
    !(
      singleWinnerKnockout &&
      isDrawStyleOutcomeLabel(
        market.entries.find((e) => e.id === scout.proposedWinnerEntryId)?.label,
      )
    )
      ? scout.proposedWinnerEntryId
      : null;
  // Upstream closed with no mappable winner — scout leans void (escalate-only).
  // Knockout "confirm advancing team" assessments leave proposedWinner null
  // with resolve_soon / near_certain — those must NOT open the void form.
  const scoutSuggestsVoid =
    !!scout &&
    (scout.stage === "met" || scout.recommendedAction === "resolve_now") &&
    !scout.proposedWinnerEntryId &&
    !singleWinnerKnockout;

  // Pre-select the scout's proposed winner when the dialog opens, so a
  // confident assessment becomes a one-click confirm. The operator can
  // still change the selection before resolving. When the scout leans
  // void (unmappable upstream), surface the void form with a suggested
  // reason — still requires an explicit confirm click.
  useEffect(() => {
    if (!open) return;
    if (scoutSuggestsVoid) {
      setShowVoid(true);
      setVoidReason((prev) =>
        prev.trim()
          ? prev
          : scout?.whatChanged ||
            "Upstream resolved with no mappable winner — voiding.",
      );
      return;
    }
    setShowVoid(false);
    if (scoutProposedEntry) {
      setSelectedEntry(scoutProposedEntry);
      return;
    }
    setSelectedEntry((prev) => {
      if (!prev) return prev;
      const label = market.entries.find((e) => e.id === prev)?.label;
      if (singleWinnerKnockout && isDrawStyleOutcomeLabel(label)) return null;
      return prev;
    });
  }, [open, scoutProposedEntry, scoutSuggestsVoid, scout?.whatChanged, singleWinnerKnockout, market.entries]);

  // Parimutuel preview is the only path that needs a server-rendered
  // payout breakdown; AMM payouts are always 1 credit per winning
  // share so we skip the preview call and rely on the inspector.
  const { data: preview, isLoading: previewLoading } = useQuery<ResolutionPreview>({
    queryKey: ["/api/admin/markets", market.id, "preview-resolution"],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/markets/${market.id}/preview-resolution`);
      if (!res.ok) throw new Error("Failed to preview");
      return res.json();
    },
    enabled: open && !isAmm,
  });

  const invalidateAfter = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/pending"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets/resolved"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/markets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/ops-summary"] });
    for (const k of invalidateOnSettle) {
      queryClient.invalidateQueries({ queryKey: [...k] });
    }
  };

  const settleMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isAmm
        ? `/api/admin/markets/${market.id}/amm-resolve`
        : isNative
          ? `/api/admin/native-markets/${market.id}/settle`
          : `/api/admin/open-markets/${market.id}/settle`;
      const body = isAmm
        ? { winnerEntryId: selectedEntry, notes }
        : isNative
          ? { winnerEntryId: selectedEntry, notes }
          : { winnerEntryId: selectedEntry, resolutionNotes: notes };
      const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        // Prefer the human-readable `message` (e.g. the self-resolution
        // guard) over the machine `error` code so toasts read cleanly.
        const msg = err.message || err.error || "Failed to settle";
        const isAlreadySettled = /already (resolved|settled)/i.test(msg) || /not.*OPEN|not.*CLOSED_PENDING/i.test(msg);
        if (isAlreadySettled) {
          return { alreadySettled: true, message: msg };
        }
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.alreadySettled) {
        toast("Already Resolved", { description: "This market was already settled — no action needed." });
      } else {
        toast("Market Resolved", { description: "Payouts distributed successfully" });
      }
      invalidateAfter();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error("Settlement Failed", { description: err.message }),
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const isNative = market.marketType !== "community";
      const url = isAmm
        ? `/api/admin/markets/${market.id}/amm-resolve`
        : isNative
          ? `/api/admin/native-markets/${market.id}/settle`
          : `/api/admin/open-markets/${market.id}/void`;
      const body = isAmm
        ? { voidMarket: true, notes: voidReason }
        : isNative
          ? { notes: voidReason }
          : { voidReason };
      const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed to void" }));
        throw new Error(err.message || err.error || "Failed to void");
      }
      return res.json();
    },
    onSuccess: () => {
      toast("Market Voided", { description: "All stakes refunded" });
      invalidateAfter();
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error("Void Failed", { description: err.message }),
  });

  const selectedPreview = preview?.entries.find((e) => e.entryId === selectedEntry);

  const isMobile = useIsMobile();

  const scoutProposedLabel = scoutProposedEntry
    ? market.entries.find((e) => e.id === scoutProposedEntry)?.label ?? null
    : null;

  const selectedEntryLabel = selectedEntry
    ? market.entries.find((e) => e.id === selectedEntry)?.label
    : null;
  const drawSelectionBlocked =
    singleWinnerKnockout && isDrawStyleOutcomeLabel(selectedEntryLabel);

  const body = (
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap text-sm text-muted-foreground">
            <MarketTypeBadge type={market.marketType} />
            {isAmm && (
              <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                LMSR / AMM
              </Badge>
            )}
            {typeof market.pool === "number" && (
              <span className="flex items-center gap-1"><Coins className="h-3.5 w-3.5" /> {CURRENCY.symbol}{market.pool} pool</span>
            )}
            {typeof market.uniqueBettors === "number" && (
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {market.uniqueBettors} bettors</span>
            )}
          </div>
          {isAmm && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">
              This is an AMM market. Settling pays each holder of the winning side
              <span className="font-mono"> Ꝟ1 per share</span>; voiding refunds every position at its cost basis. The house keeps the rest as market-maker P/L.
            </div>
          )}

          {singleWinnerKnockout && !showVoid && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              Single-winner knockout: resolve to the team that advanced (including
              extra time / penalties). <span className="font-medium">Draw is not a valid outcome</span> —
              even if Polymarket&apos;s 90-minute moneyline settled Draw.
            </div>
          )}

          <ResolutionRulesPanel
            criteria={market.resolutionCriteria}
            sourceRulesText={market.sourceRulesText}
            sourceUrl={market.sourceUrl}
          />

          {scout && !showVoid && (
            <ScoutPanel
              scout={scout}
              proposedEntryLabel={scoutProposedLabel}
              onUseProposed={
                scoutProposedEntry ? () => setSelectedEntry(scoutProposedEntry) : undefined
              }
              suggestVoid={scoutSuggestsVoid}
              onSuggestVoid={
                scoutSuggestsVoid
                  ? () => {
                      setShowVoid(true);
                      setVoidReason((prev) =>
                        prev.trim()
                          ? prev
                          : scout?.whatChanged ||
                            "Upstream resolved with no mappable winner — voiding.",
                      );
                    }
                  : undefined
              }
            />
          )}

          {scout && showVoid && scoutSuggestsVoid && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              Scout suggests voiding — upstream closed with no mappable winner. Confirm below or cancel to pick an outcome instead.
            </div>
          )}

          {!showVoid && isAmm ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Select winning outcome:</p>
              {[...market.entries]
                .sort((a, b) => {
                  const aOther = isOtherStyleOutcomeLabel(a.label) ? 1 : 0;
                  const bOther = isOtherStyleOutcomeLabel(b.label) ? 1 : 0;
                  return aOther - bOther;
                })
                .map((entry) => {
                const isSelected = selectedEntry === entry.id;
                const isOther = isOtherStyleOutcomeLabel(entry.label);
                const drawBlocked =
                  singleWinnerKnockout && isDrawStyleOutcomeLabel(entry.label);
                return (
                  <Card
                    key={entry.id}
                    className={`transition-colors ${
                      drawBlocked
                        ? "opacity-50 cursor-not-allowed"
                        : `cursor-pointer ${isSelected ? "ring-2 ring-primary" : ""}`
                    }`}
                    onClick={() => {
                      if (drawBlocked) return;
                      setSelectedEntry(entry.id);
                    }}
                    data-testid={`entry-option-${entry.id}`}
                  >
                    <CardContent className="p-4 flex items-center gap-2">
                      <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground/30"}`}>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <span className={`font-medium ${isOther || drawBlocked ? "text-muted-foreground italic" : ""}`}>
                        {entry.label}
                      </span>
                      {drawBlocked && (
                        <Badge
                          variant="outline"
                          className="text-xs border-amber-500/40 text-amber-700 dark:text-amber-300"
                        >
                          Not valid (knockout)
                        </Badge>
                      )}
                      {scoutProposedEntry === entry.id && (
                        <Badge
                          variant="outline"
                          className="text-xs border-0 bg-sky-500/15 text-sky-700 dark:text-sky-300 gap-1"
                        >
                          <Sparkles className="h-3 w-3" /> AI pick
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className="space-y-2">
                <label className="text-sm font-medium">Resolution Notes</label>
                <Textarea
                  placeholder="e.g., Confirmed via AP News report on Feb 25..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="input-resolution-notes"
                />
              </div>
            </div>
          ) : previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview && !showVoid ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Select winning outcome:</p>
              {preview.entries.map((entry) => {
                const isSelected = selectedEntry === entry.entryId;
                const stakePercent = preview.totalPool > 0 ? Math.round((entry.totalStaked / preview.totalPool) * 100) : 0;
                return (
                  <Card
                    key={entry.entryId}
                    className={`cursor-pointer transition-colors ${isSelected ? "ring-2 ring-primary" : ""}`}
                    onClick={() => setSelectedEntry(entry.entryId)}
                    data-testid={`entry-option-${entry.entryId}`}
                  >
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                          <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground/30"}`}>
                            {isSelected && <div className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                          <span className="font-medium">{entry.entryLabel}</span>
                        </div>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                          <span>{entry.betCount} bets</span>
                          <span>{CURRENCY.symbol}{entry.totalStaked} ({stakePercent}%)</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary/60 rounded-full" style={{ width: `${stakePercent}%` }} />
                      </div>
                      {isSelected && entry.winnersCount > 0 && (
                        <div className="mt-2 p-3 rounded-md bg-muted/50 space-y-2">
                          <p className="text-sm font-medium">Payout Preview</p>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <p className="text-muted-foreground">Winners</p>
                              <p className="font-medium text-green-600 dark:text-green-400">{entry.winnersCount}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Total Payouts</p>
                              <p className="font-medium">{CURRENCY.symbol}{entry.totalPayouts}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Remainder</p>
                              <p className="font-medium">{entry.remainder}</p>
                            </div>
                          </div>
                          {entry.payoutDetails.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <p className="text-xs text-muted-foreground">Top payouts:</p>
                              {entry.payoutDetails.map((p, i) => (
                                <div key={p.userId || `payout-${i}`} className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">{p.username}</span>
                                  <span className="font-medium">{CURRENCY.symbol}{p.stake} → {CURRENCY.symbol}{p.payout}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {isSelected && entry.winnersCount === 0 && (
                        <div className="mt-2 p-3 rounded-md bg-muted/50">
                          <p className="text-sm text-muted-foreground">No bets on this outcome — no payouts to distribute</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              <div className="space-y-2">
                <label className="text-sm font-medium">Resolution Notes</label>
                <Textarea
                  placeholder="e.g., Confirmed via AP News report on Feb 25..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-testid="input-resolution-notes"
                />
              </div>
            </div>
          ) : showVoid ? (
            <div className="space-y-3">
              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                <p className="text-sm font-medium text-destructive">Void Market</p>
                <p className="text-xs text-muted-foreground mt-1">All stakes will be refunded to bettors. This cannot be undone.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Reason for voiding (required)</label>
                <Textarea
                  placeholder="Why is this market being voided?"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  data-testid="input-void-reason"
                />
              </div>
            </div>
          ) : null}
        </div>
  );

  // Shared footer buttons. Rendered inside a flex-col-reverse container on
  // mobile (primary action on top) and the standard DialogFooter on desktop.
  const footerButtons = !showVoid ? (
    <>
      <Button
        variant="outline"
        onClick={() => setShowVoid(true)}
        className="text-destructive h-11 md:h-9"
        data-testid="button-show-void"
      >
        <XCircle className="h-4 w-4 mr-2" />
        Void Instead
      </Button>
      <Button
        onClick={() => settleMutation.mutate()}
        disabled={!selectedEntry || drawSelectionBlocked || settleMutation.isPending}
        className="h-11 md:h-9"
        data-testid="button-confirm-resolve"
      >
        {settleMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        {settleMutation.isPending
          ? "Resolving..."
          : selectedPreview
            ? `Resolve — ${CURRENCY.symbol}${selectedPreview.totalPayouts} to ${selectedPreview.winnersCount} winner${selectedPreview.winnersCount !== 1 ? "s" : ""}`
            : isAmm && selectedEntry
              ? "Resolve — pay Ꝟ1 per winning share"
              : "Select an outcome"}
      </Button>
    </>
  ) : (
    <>
      <Button variant="outline" onClick={() => setShowVoid(false)} className="h-11 md:h-9" data-testid="button-cancel-void">
        Back
      </Button>
      <Button
        variant="destructive"
        onClick={() => voidMutation.mutate()}
        disabled={!voidReason.trim() || voidMutation.isPending}
        className="h-11 md:h-9"
        data-testid="button-confirm-void"
      >
        {voidMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
        {voidMutation.isPending ? "Voiding..." : "Void & Refund All Stakes"}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="flex items-center gap-2">
              <Gavel className="h-5 w-5" />
              Resolve Market
            </DrawerTitle>
            <DrawerDescription>{market.title}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-2">{body}</div>
          <DrawerFooter
            className="flex-col-reverse gap-2 border-t border-border"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            {footerButtons}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Gavel className="h-5 w-5" />
            Resolve Market
          </DialogTitle>
          <DialogDescription>{market.title}</DialogDescription>
        </DialogHeader>

        {body}

        <DialogFooter className="flex-col sm:flex-row gap-2">{footerButtons}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
