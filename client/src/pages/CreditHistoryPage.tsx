import { useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Wallet, TrendingUp, TrendingDown, Settings2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCreditHistory } from "@/hooks/useGamification";
import { bucketForTxnType, labelForTxnType } from "@shared/credit-config";
import { CURRENCY, formatVox, voxWord } from "@/lib/currency";

/**
 * Per-user Vox history. Mirrors the data shown by the admin
 * AdminUserCreditHistory component but trimmed to the fields a
 * normal user cares about (no idempotency keys, no source column,
 * no drift indicator). Powered by `useCreditHistory()` which had
 * been exported with zero consumers since the credit ledger was
 * first added (internal table name kept, display reads as "Vox").
 */

type FilterId = "all" | "earned" | "spent";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "earned", label: "Earned" },
  { id: "spent", label: "Spent" },
];

interface CreditLedgerRow {
  id: string;
  txnType: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  displayTitle?: string;
  displaySubtitle?: string;
  href?: string;
}

export default function CreditHistoryPage() {
  const [, setLocation] = useLocation();
  const { profile, isLoggedIn } = useAuth();
  const [filter, setFilter] = useState<FilterId>("all");

  const { data, isLoading } = useCreditHistory(100, isLoggedIn);

  const rows: CreditLedgerRow[] = Array.isArray(data) ? data : [];

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter(
      (r) => bucketForTxnType(r.txnType, r.amount) === filter,
    );
  }, [rows, filter]);

  const balance = profile?.predictCredits ?? 0;

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-16 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            data-testid="button-back-credit-history"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">My Vox</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-[964px] space-y-6">
        <Card className="p-6 bg-gradient-to-br from-violet-500/10 to-transparent border-violet-500/30">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Current balance
            </p>
          </div>
          <p className="text-4xl font-bold font-mono text-violet-600 dark:text-violet-400">
            {formatVox(balance)}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Spend Vox on predictions; earn it by voting, commenting,
            posting insights, hitting streak milestones, and through
            admin-approved suggestions.
          </p>
          <Button
            className="mt-4 w-full sm:w-auto bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-700 hover:to-violet-600"
            onClick={() => setLocation("/pricing")}
            data-testid="button-buy-credits-history"
          >
            <Wallet className="h-4 w-4 mr-2" />
            Buy Vox
          </Button>
        </Card>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f.id)}
              data-testid={`filter-credit-${f.id}`}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h3 className="text-sm font-semibold">Recent activity</h3>
          </div>
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                {filter === "all"
                  ? "No Vox activity yet. Cast a vote, post an insight, or place a prediction to get started."
                  : "Nothing in this filter."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((row) => (
                <CreditLedgerRowItem key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Card>
      </main>
    </div>
  );
}

function CreditLedgerRowItem({ row }: { row: CreditLedgerRow }) {
  const bucket = bucketForTxnType(row.txnType, row.amount);
  const date = new Date(row.createdAt);
  const dateLabel = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  // Mirror `formatVoxDelta` semantics but keep the integer rendering
  // the ledger has always used — these rows are whole-Vox amounts
  // (signup grants, prediction stakes, settlement payouts), so the
  // forced 2dp from `formatVoxDelta` would add noise for no signal.
  const amountStr = row.amount >= 0
    ? `+${CURRENCY.symbol}${row.amount.toLocaleString("en-US")}`
    : `\u2212${CURRENCY.symbol}${Math.abs(row.amount).toLocaleString("en-US")}`;
  const tone =
    bucket === "earned"
      ? "text-emerald-600 dark:text-emerald-400"
      : bucket === "spent"
        ? "text-rose-600 dark:text-rose-400"
        : "text-amber-600 dark:text-amber-400";

  const Icon =
    bucket === "earned"
      ? TrendingUp
      : bucket === "spent"
        ? TrendingDown
        : Settings2;

  const title = row.displayTitle ?? labelForTxnType(row.txnType);
  const subtitle = row.displaySubtitle;

  const inner = (
    <>
      <div className="flex items-start gap-3 min-w-0">
        <div className={`mt-0.5 ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium line-clamp-2">{title}</p>
          {subtitle ? (
            <p className="text-xs text-muted-foreground line-clamp-1">{subtitle}</p>
          ) : null}
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateLabel} · {timeLabel}
          </p>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={`text-sm font-mono font-semibold ${tone}`}>
          {amountStr}
        </p>
        <p className="text-[11px] text-muted-foreground font-mono hidden sm:block">
          balance {formatVox(row.balanceAfter)}
        </p>
      </div>
    </>
  );

  const rowClass =
    "flex items-center justify-between gap-3 px-4 py-3 w-full text-left";

  if (row.href) {
    return (
      <li data-testid={`credit-row-${row.id}`}>
        <Link
          href={row.href}
          aria-label={`${title}, ${row.amount >= 0 ? "+" : "\u2212"}${voxWord(Math.abs(row.amount))}`}
          className={`${rowClass} hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}
        >
          {inner}
        </Link>
      </li>
    );
  }

  return (
    <li
      className={rowClass}
      data-testid={`credit-row-${row.id}`}
    >
      {inner}
    </li>
  );
}
