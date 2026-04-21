import { useState } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PredictionMarket } from "./adminTypes";

interface SettleMarketModalProps {
  market: PredictionMarket | null;
  entries: { id: string; label: string; totalStake: number }[];
  open: boolean;
  onClose: () => void;
  onSettle: (winnerEntryId: string, notes: string) => void;
  isPending: boolean;
}

/**
 * Modal for settling a prediction market. Admin picks the winning outcome
 * and optionally leaves resolution notes.
 *
 * Extracted from AdminDashboard.tsx as part of the monolith-shrinking refactor.
 */
export function SettleMarketModal({
  market,
  entries,
  open,
  onClose,
  onSettle,
  isPending,
}: SettleMarketModalProps) {
  const [winnerId, setWinnerId] = useState("");
  const [notes, setNotes] = useState("");

  if (!market) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settle Market</DialogTitle>
          <DialogDescription>Select the winning outcome for: {market.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Winning Outcome</Label>
            {entries.map(entry => (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center justify-between gap-2 p-3 rounded-lg border cursor-pointer transition-colors",
                  winnerId === entry.id ? "border-green-500 bg-green-500/15 dark:bg-green-500/10" : "hover-elevate"
                )}
                onClick={() => setWinnerId(entry.id)}
                data-testid={`settle-entry-${entry.id}`}
              >
                <span className="font-medium">{entry.label}</span>
                <Badge variant="outline">{entry.totalStake} staked</Badge>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label>Resolution Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why was this outcome selected?"
              className="resize-none"
              data-testid="input-settle-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSettle(winnerId, notes)}
            disabled={!winnerId || isPending}
            data-testid="button-confirm-settle"
          >
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Settle Market
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
