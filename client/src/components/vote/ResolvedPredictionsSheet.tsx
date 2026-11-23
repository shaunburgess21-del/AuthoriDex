import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Share2 } from "lucide-react";
import { useShareCard } from "@/contexts/ShareCardContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { VoxText } from "@/components/VoxText";
import {
  resolvedBatchNet,
  resolvedBatchNetLabel,
  resolvedBetSentence,
} from "@/lib/resolvedBetCopy";
import type { ResolvedRevealRow } from "@/lib/resolvedReveal";
import { winShareArgs } from "@/lib/shareWin";

function useCoarseSheet(): boolean {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const onChange = () => setMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function RevealBody({
  rows,
  onShareWin,
}: {
  rows: ResolvedRevealRow[];
  onShareWin: (row: ResolvedRevealRow) => void;
}) {
  const netLabel = resolvedBatchNetLabel(resolvedBatchNet(rows));
  return (
    <div className="flex max-h-[70vh] flex-col">
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2" data-testid="resolved-reveal-list">
        {rows.map((row) => {
          const sentence = resolvedBetSentence(row);
          const won = row.result === "won";
          return (
            <li
              key={row.betId}
              className="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5"
              data-testid={`resolved-reveal-row-${row.betId}`}
            >
              <p className="text-sm font-medium leading-snug text-foreground">
                {sentence ? <VoxText text={sentence} /> : "Settled"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.marketTitle}</p>
              {row.entryLabel ? (
                <p className="truncate text-[11px] text-muted-foreground/80">{row.entryLabel}</p>
              ) : null}
              {won && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 gap-1 border-amber-500/30 bg-amber-500/10 px-2 text-[11px] text-amber-600 hover:bg-amber-500/20 dark:text-amber-300"
                  onClick={() => onShareWin(row)}
                  data-testid={`resolved-reveal-share-${row.betId}`}
                >
                  <Share2 className="h-3 w-3" />
                  Share Win
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <p className="text-sm font-semibold tabular-nums" data-testid="resolved-reveal-net">
          <VoxText text={netLabel} />
        </p>
        <Link
          href="/me/predictions"
          className="text-xs font-medium text-cyan-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:text-cyan-400"
          data-testid="resolved-reveal-see-all"
        >
          See all in My Predictions
        </Link>
      </div>
    </div>
  );
}

/**
 * Newly settled bets from the vote strip. A drawer on a phone, a
 * dialog on a wider window. Wins get one small confetti burst.
 * Losses stay still. Reduced motion skips the burst.
 */
export function ResolvedPredictionsSheet({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ResolvedRevealRow[];
}) {
  const mobile = useCoarseSheet();
  const { openShareCard } = useShareCard();
  const hasWin = rows.some((row) => row.result === "won");

  useEffect(() => {
    if (!open || !hasWin || prefersReducedMotion()) return;
    let cancelled = false;
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      confetti({
        particleCount: 36,
        spread: 50,
        startVelocity: 24,
        scalar: 0.8,
        origin: { x: 0.5, y: 0.32 },
        colors: ["#22d3ee", "#fbbf24", "#e2e8f0"],
        disableForReducedMotion: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, hasWin]);

  const onShareWin = (row: ResolvedRevealRow) => {
    openShareCard(winShareArgs(row));
  };

  const title = rows.length === 1 ? "1 prediction settled" : `${rows.length} predictions settled`;
  const description = "Virtual credits only. Vox isn't cash.";

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh] focus:outline-none" data-testid="resolved-reveal-sheet">
          <DrawerHeader className="px-4 pb-2 text-left">
            <DrawerTitle className="text-base">{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <RevealBody rows={rows} onShareWin={onShareWin} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" data-testid="resolved-reveal-sheet">
        <DialogHeader className="px-4 pb-2 pt-4 pr-12 text-left">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <RevealBody rows={rows} onShareWin={onShareWin} />
      </DialogContent>
    </Dialog>
  );
}
