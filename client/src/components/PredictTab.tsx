import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/PersonAvatar";
import { BattleCard, HeadToHeadBattle } from "@/components/BattleCard";
import { useMarketCycle } from "@/hooks/useMarketCycle";
import { Crown, Sparkles, Lock, Target } from "lucide-react";

interface PredictTabProps {
  personId: string;
  personName: string;
  personAvatar?: string;
  currentScore: number;
}

// All available prediction markets
const allBattles: HeadToHeadBattle[] = [
  {
    id: "battle-1",
    title: "Elon Musk vs Mark Zuckerberg",
    person1: { name: "Elon Musk", avatar: "" },
    person2: { name: "Mark Zuckerberg", avatar: "" },
    category: "Tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "battle-2",
    title: "Taylor Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "" },
    person2: { name: "Beyoncé", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "battle-3",
    title: "Drake vs Kendrick Lamar",
    person1: { name: "Drake", avatar: "" },
    person2: { name: "Kendrick Lamar", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "battle-4",
    title: "Cristiano Ronaldo vs Lionel Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "" },
    person2: { name: "Lionel Messi", avatar: "" },
    category: "Sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 32100,
    person1Percent: 51,
  },
  {
    id: "battle-5",
    title: "Donald Trump vs Joe Biden",
    person1: { name: "Donald Trump", avatar: "" },
    person2: { name: "Joe Biden", avatar: "" },
    category: "Politics",
    endTime: "Sun 23:59 UTC",
    totalPool: 45000,
    person1Percent: 58,
  },
];

// Base jackpot pool amount (consistent with PredictPage)
const BASE_JACKPOT_POOL = 50000;

export function PredictTab({ personId, personName, personAvatar, currentScore }: PredictTabProps) {
  const marketCycle = useMarketCycle();
  const isMarketClosed = marketCycle.status === "CLOSED";
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [stakeAmount, setStakeAmount] = useState("");
  const [exactPrediction, setExactPrediction] = useState("");

  // Filter battles where the current person is involved
  const personBattles = allBattles.filter(
    (battle) =>
      battle.person1.name === personName || 
      battle.person2.name === personName
  );

  return (
    <div className="space-y-6">
      {/* Test Mode Badge */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            TEST MODE
          </Badge>
          <span className="text-sm text-muted-foreground">
            Predictions use virtual credits only. No real money involved.
          </span>
        </div>
      </Card>

      {/* Weekly Jackpot Widget - Static for this person */}
      <div 
        className="relative overflow-hidden rounded-xl border-2 border-amber-500/50"
        style={{
          background: "linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 146, 60, 0.05) 50%, transparent 100%)",
          boxShadow: "inset 0 0 20px rgba(245, 158, 11, 0.1), 0 0 30px rgba(245, 158, 11, 0.1)",
        }}
        data-testid="profile-jackpot-widget"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-orange-500/10 rounded-full blur-2xl" />
        
        <div className="relative z-10 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="h-5 w-5 text-amber-500" />
            <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40 text-xs">
              WEEKLY JACKPOT
            </Badge>
          </div>
          
          <h3 className="text-lg font-serif font-bold mb-2">
            Predict {personName}'s Exact Score
          </h3>
          
          <p className="text-sm text-muted-foreground mb-4">
            Guess the exact FameDex score at week's end. Closest prediction takes the entire pot!
          </p>
          
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-3">
              <PersonAvatar name={personName} avatar={personAvatar || ""} size="md" />
              <div>
                <p className="font-semibold">{personName}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Current: {currentScore.toLocaleString()} pts
                </p>
              </div>
            </div>
            
            <div className="h-10 w-px bg-border hidden sm:block" />
            
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Pot</p>
              <p className="text-xl font-mono font-bold text-amber-500">
                {BASE_JACKPOT_POOL.toLocaleString()}
                <span className="text-xs ml-1 text-muted-foreground">credits</span>
              </p>
            </div>
            
            <div className="h-10 w-px bg-border hidden sm:block" />
            
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Ends In</p>
              <p className="text-sm font-mono font-bold">
                {marketCycle.timeRemaining.days}d {marketCycle.timeRemaining.hours}h {marketCycle.timeRemaining.minutes}m
              </p>
            </div>
          </div>
          
          {isMarketClosed ? (
            <Button 
              className="bg-muted text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Lock className="h-4 w-4 mr-2" />
              Awaiting Results
            </Button>
          ) : (
            <Button 
              className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30"
              onClick={() => setShowPredictionModal(true)}
              data-testid="button-profile-predict-score"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Predict Score
            </Button>
          )}
        </div>
      </div>

      {/* Prediction Modal */}
      <Dialog open={showPredictionModal} onOpenChange={setShowPredictionModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-500" />
              Enter Weekly Jackpot
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <PersonAvatar name={personName} avatar={personAvatar || ""} size="md" />
              <div>
                <p className="font-semibold">{personName}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  Current: {currentScore.toLocaleString()} pts
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Your Exact Score Prediction</label>
              <Input
                type="number"
                placeholder="Enter predicted score (e.g., 520000)"
                value={exactPrediction}
                onChange={(e) => setExactPrediction(e.target.value)}
                className="font-mono"
                data-testid="input-profile-exact-prediction"
              />
              <p className="text-xs text-muted-foreground">
                Predict the exact score at week's end. Closest wins the jackpot!
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Stake Amount</label>
              <Input
                type="number"
                placeholder="Enter credits to stake"
                value={stakeAmount}
                onChange={(e) => setStakeAmount(e.target.value)}
                className="font-mono"
                data-testid="input-profile-stake-amount"
              />
            </div>

            <div className="flex gap-2 pt-2">
              {[100, 500, 1000].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => setStakeAmount(amount.toString())}
                  className="flex-1"
                >
                  {amount}
                </Button>
              ))}
            </div>
          </div>

          <Button 
            onClick={() => setShowPredictionModal(false)} 
            className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-white"
            data-testid="button-profile-confirm-prediction"
          >
            Confirm Prediction
          </Button>
        </DialogContent>
      </Dialog>

      {/* Predictions List */}
      {personBattles.length > 0 ? (
        <div className="space-y-4">
          <div className="mb-6">
            <h3 className="text-lg font-serif font-bold mb-2">
              Active Markets for {personName}
            </h3>
            <p className="text-sm text-muted-foreground">
              {personBattles.length} prediction{personBattles.length !== 1 ? "s" : ""} available
            </p>
          </div>
          {personBattles.map((battle) => (
            <BattleCard key={battle.id} battle={battle} compact={true} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-3">
            <p className="text-lg font-semibold">No active markets</p>
            <p className="text-muted-foreground">
              There are currently no prediction markets for {personName}.
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Check back later or visit the main Prediction Markets page to explore all available markets.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
