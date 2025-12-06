import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { TrendingUp, TrendingDown, Zap, Clock, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";

interface PredictTabProps {
  personId: string;
  personName: string;
  currentScore: number;
}

export function PredictTab({ personId, personName, currentScore }: PredictTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showModal, setShowModal] = useState(false);
  const [selectedDirection, setSelectedDirection] = useState<"up" | "down" | null>(null);
  const [betAmount, setBetAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const upOdds = 1.8;
  const downOdds = 2.1;
  const userBalance = 1000;

  const getEndTime = () => {
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() + (7 - now.getDay()));
    sunday.setHours(23, 59, 0, 0);
    return sunday.toLocaleDateString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  };

  const handleOpenModal = () => {
    if (!user) {
      toast({
        title: "Sign in required",
        description: "Please sign in to make predictions",
        variant: "destructive",
      });
      setLocation("/login");
      return;
    }
    setShowModal(true);
  };

  const handleSelectDirection = (direction: "up" | "down") => {
    setSelectedDirection(direction);
  };

  const calculatePayout = () => {
    const amount = parseFloat(betAmount) || 0;
    const odds = selectedDirection === "up" ? upOdds : downOdds;
    return (amount * odds).toFixed(0);
  };

  const handleConfirmPrediction = async () => {
    if (!selectedDirection || !betAmount) {
      toast({
        title: "Incomplete prediction",
        description: "Please select a direction and enter an amount",
        variant: "destructive",
      });
      return;
    }

    const amount = parseFloat(betAmount);
    if (amount <= 0 || amount > userBalance) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount within your balance",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    console.log("Test Prediction Placed:", {
      personId,
      personName,
      direction: selectedDirection,
      amount: betAmount,
      odds: selectedDirection === "up" ? upOdds : downOdds,
      estimatedPayout: calculatePayout(),
      timestamp: new Date().toISOString(),
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    toast({
      title: "Test prediction placed!",
      description: `You predicted ${personName}'s score will go ${selectedDirection} for ${betAmount} TC`,
    });

    setIsSubmitting(false);
    setShowModal(false);
    setSelectedDirection(null);
    setBetAmount("");
  };

  const ModalContent = () => (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-muted-foreground">
          Will {personName}'s FameDex Trend Score be higher or lower at the end of this week?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => handleSelectDirection("up")}
          className={`p-4 rounded-lg border-2 transition-all ${
            selectedDirection === "up"
              ? "border-green-500 bg-green-500/10"
              : "border-border hover:border-green-500/50"
          }`}
          data-testid="button-select-up"
        >
          <TrendingUp className={`h-8 w-8 mx-auto mb-2 ${selectedDirection === "up" ? "text-green-500" : "text-muted-foreground"}`} />
          <p className={`font-semibold ${selectedDirection === "up" ? "text-green-500" : ""}`}>Up</p>
          <p className="text-sm text-muted-foreground">{upOdds}x payout</p>
        </button>
        <button
          onClick={() => handleSelectDirection("down")}
          className={`p-4 rounded-lg border-2 transition-all ${
            selectedDirection === "down"
              ? "border-red-500 bg-red-500/10"
              : "border-border hover:border-red-500/50"
          }`}
          data-testid="button-select-down"
        >
          <TrendingDown className={`h-8 w-8 mx-auto mb-2 ${selectedDirection === "down" ? "text-red-500" : "text-muted-foreground"}`} />
          <p className={`font-semibold ${selectedDirection === "down" ? "text-red-500" : ""}`}>Down</p>
          <p className="text-sm text-muted-foreground">{downOdds}x payout</p>
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Amount (Test Credits)</label>
        <div className="relative">
          <Input
            type="number"
            placeholder="Enter amount"
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            className="pr-12"
            data-testid="input-bet-amount"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            TC
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Your balance: {userBalance.toLocaleString()} TC
        </p>
      </div>

      {selectedDirection && betAmount && parseFloat(betAmount) > 0 && (
        <Card className="p-4 bg-primary/5 border-primary/20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Estimated Payout</span>
            <span className="font-mono font-bold text-lg text-primary">
              {calculatePayout()} TC
            </span>
          </div>
        </Card>
      )}

      <Button
        onClick={handleConfirmPrediction}
        disabled={!selectedDirection || !betAmount || isSubmitting}
        className="w-full"
        data-testid="button-confirm-prediction"
      >
        {isSubmitting ? "Placing Prediction..." : "Place Test Prediction"}
      </Button>

      <p className="text-xs text-center text-muted-foreground">
        This is test mode. No real money is involved.
      </p>
    </div>
  );

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="max-w-2xl mx-auto">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Zap className="h-6 w-6 text-primary" />
          <h3 className="text-xl font-serif font-bold">Weekly Trend Score Prediction</h3>
        </div>

        <p className="text-muted-foreground mb-6">
          Will {personName}'s FameDex Trend Score be higher or lower at the end of this week?
        </p>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-sm text-muted-foreground mb-1">Current Score</p>
            <p className="font-mono font-bold text-lg">{currentScore.toLocaleString()}</p>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
              <Clock className="h-3 w-3" />
              <span>Ends</span>
            </div>
            <p className="font-semibold">{getEndTime()}</p>
          </div>
        </div>

        <div className="flex gap-3 mb-6">
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30 px-4 py-2">
            <TrendingUp className="h-4 w-4 mr-2" />
            Up {upOdds}x
          </Badge>
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30 px-4 py-2">
            <TrendingDown className="h-4 w-4 mr-2" />
            Down {downOdds}x
          </Badge>
        </div>

        <Button 
          onClick={handleOpenModal} 
          className="w-full gap-2"
          data-testid="button-predict-and-win"
        >
          <DollarSign className="h-4 w-4" />
          Predict & Win (Test Mode)
        </Button>
      </Card>

      <Card className="mt-4 p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            TEST MODE
          </Badge>
          <span className="text-sm text-muted-foreground">
            Predictions use virtual credits only. No real money involved.
          </span>
        </div>
      </Card>

      {isMobile ? (
        <Sheet open={showModal} onOpenChange={setShowModal}>
          <SheetContent side="bottom" className="rounded-t-2xl">
            <SheetHeader className="mb-4">
              <SheetTitle>Make Your Prediction</SheetTitle>
              <SheetDescription>
                Predict {personName}'s weekly trend direction
              </SheetDescription>
            </SheetHeader>
            <ModalContent />
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={showModal} onOpenChange={setShowModal}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Make Your Prediction</DialogTitle>
              <DialogDescription>
                Predict {personName}'s weekly trend direction
              </DialogDescription>
            </DialogHeader>
            <ModalContent />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
