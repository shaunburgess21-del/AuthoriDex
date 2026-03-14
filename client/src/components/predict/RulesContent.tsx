import { TrendingUp, Target, Trophy, Swords, BarChart3, Globe, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export interface RulesStep {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export interface RulesEntry {
  title: string;
  description: string;
  steps: RulesStep[];
}

export const RULES_CONTENT: Record<string, RulesEntry> = {
  updown: {
    title: "How Up/Down Works",
    description: "Each week, a fixed baseline score is captured at market open (Monday 00:00 UTC). Everyone bets on whether the final score at close (Sunday 23:59 UTC) finishes above or below that same baseline.",
    steps: [
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Fixed Baseline", description: "A baseline score is locked at the start of each market period. All participants bet against this same reference point — not their personal entry time." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Pick UP or DOWN", description: "UP wins if the closing score finishes above the baseline. DOWN wins if it finishes below. Exact tie = full refund for all positions." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Stake & Win", description: "Stake your credits. Winners split the total pool proportionally. Higher multipliers mean bigger potential payouts. Auto-resolved from AuthoriDex trend data." },
    ]
  },
  h2h: {
    title: "How Head-to-Head Works",
    description: "Predict who will gain more trend points this week",
    steps: [
      { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Pick Your Winner", description: "Choose which person you think will gain more trend points by the end of the week." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Stake Your Credits", description: "Your potential multiplier depends on how many others picked the same side." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Winner Takes the Pool", description: "If your pick gains more points, you split the total pool with other winners." },
    ]
  },
  gainer: {
    title: "How Top Gainer Works",
    description: "Predict which celebrity will add the most raw points",
    steps: [
      { icon: <BarChart3 className="h-4 w-4 text-violet-500" />, title: "Raw Points Focus", description: "This market tracks total points ADDED, not percentage gain. Big names can add more raw points." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Pick Your Horse", description: "Choose who you think will add the most absolute trend points this week." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Winner Determined by Data", description: "The person with the highest raw point increase when the market closes wins." },
    ]
  },
  community: {
    title: "Real-World Markets",
    description: "These markets track verifiable global events (e.g., elections, business acquisitions, viral moments). Predictions are settled based on definitive public outcomes.",
    steps: [
      { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "Verifiable Events", description: "Markets are based on real-world outcomes that can be publicly verified - elections, acquisitions, viral milestones, and more." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Yes/No Predictions", description: "Each market has a clear binary outcome. Stake your credits on what you believe will happen." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Public Resolution", description: "Markets are settled based on definitive public information. Winners split the pool proportionally." },
    ]
  }
};

export function RulesExplainer({ title, description, steps }: RulesEntry) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="h-5 w-5 text-violet-500 shrink-0" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
              {step.icon}
            </div>
            <div>
              <h4 className="font-semibold text-sm">{step.title}</h4>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RulesModal({ open, onClose, title, description, steps }: {
  open: boolean;
  onClose: () => void;
} & RulesEntry) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-violet-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                {step.icon}
              </div>
              <div>
                <h4 className="font-semibold text-sm">{step.title}</h4>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <Button onClick={onClose} className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600">
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
