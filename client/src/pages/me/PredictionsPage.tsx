import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, TrendingUp, TrendingDown, Clock, CheckCircle, XCircle, Filter } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function PredictionsPage() {
  const { user, profile } = useAuth();
  const [, setLocation] = useLocation();

  const { data: predictions, isLoading } = useQuery({
    queryKey: ["/api/me/predictions"],
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-xl font-semibold mb-2">Sign in to view your predictions</h2>
          <Button onClick={() => setLocation("/login")} className="mt-4" data-testid="button-sign-in">
            Sign In
          </Button>
        </Card>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30"><Clock className="h-3 w-3 mr-1" />Active</Badge>;
      case "won":
        return <Badge className="bg-green-500/20 text-green-300 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" />Won</Badge>;
      case "lost":
        return <Badge className="bg-red-500/20 text-red-300 border-red-500/30"><XCircle className="h-3 w-3 mr-1" />Lost</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 h-14 flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => setLocation("/me")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="font-semibold">My Predictions</h1>
            <p className="text-xs text-muted-foreground">
              {profile?.totalPredictions || 0} predictions | {profile?.winRate || 0}% win rate
            </p>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 max-w-2xl">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{profile?.totalPredictions || 0}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{Math.round((profile?.totalPredictions || 0) * (profile?.winRate || 0) / 100)}</p>
            <p className="text-xs text-muted-foreground">Won</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-2xl font-bold text-violet-400">{profile?.winRate || 0}%</p>
            <p className="text-xs text-muted-foreground">Win Rate</p>
          </Card>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Badge variant="outline">All Predictions</Badge>
          </div>
          <Button variant="outline" size="sm" data-testid="button-filter-predictions">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : predictions && Array.isArray(predictions) && predictions.length > 0 ? (
          <div className="space-y-3">
            {predictions.map((prediction: any) => (
              <Card key={prediction.id} className="p-4" data-testid={`prediction-item-${prediction.id}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {prediction.direction === "up" ? (
                      <TrendingUp className="h-5 w-5 text-green-400" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-400" />
                    )}
                    <div>
                      <p className="font-medium">{prediction.marketTitle || "Prediction"}</p>
                      <p className="text-xs text-muted-foreground">{prediction.celebrity || ""}</p>
                    </div>
                  </div>
                  {getStatusBadge(prediction.status)}
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Stake: {prediction.stake} credits</span>
                  {prediction.payout && (
                    <span className={prediction.payout > 0 ? "text-green-400" : "text-red-400"}>
                      {prediction.payout > 0 ? "+" : ""}{prediction.payout} credits
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center">
            <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">No predictions yet</h2>
            <p className="text-muted-foreground mb-4">
              Make your first prediction on celebrity trends and fame movements.
            </p>
            <Button onClick={() => setLocation("/predict")} data-testid="button-start-predicting">
              Start Predicting
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
