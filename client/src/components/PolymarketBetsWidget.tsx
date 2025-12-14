import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, ExternalLink, DollarSign, Clock } from "lucide-react";

interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  volume: number;
  endDate: string;
}

interface PolymarketBetsWidgetProps {
  personName: string;
}

export function PolymarketBetsWidget({ personName }: PolymarketBetsWidgetProps) {
  const [markets, setMarkets] = useState<PolymarketMarket[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMarkets() {
      if (!personName) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Use backend proxy to avoid CORS issues
        const response = await fetch("/api/polymarket/markets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ personName }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const result = await response.json();

        if (result.error) {
          throw new Error(result.error);
        }

        setMarkets(result.markets || []);
      } catch (err) {
        console.error("Error fetching Polymarket data:", err);
        setError("Unable to load prediction markets");
        setMarkets([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchMarkets();
  }, [personName]);

  const formatVolume = (volume: number): string => {
    if (volume >= 1000000) {
      return `$${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `$${(volume / 1000).toFixed(1)}K`;
    }
    return `$${volume.toFixed(0)}`;
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "TBD";
    }
  };

  const getMarketUrl = (slug: string): string => {
    return `https://polymarket.com/event/${slug}`;
  };

  if (isLoading) {
    return (
      <div className="mt-12" data-testid="section-polymarket-bets">
        <h2 className="text-2xl font-serif font-bold mb-6">Polymarket Bets</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-5 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-12" data-testid="section-polymarket-bets">
        <h2 className="text-2xl font-serif font-bold mb-6">Polymarket Bets</h2>
        <Card className="p-6 text-center border-dashed">
          <p className="text-muted-foreground">{error}</p>
        </Card>
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="mt-12" data-testid="section-polymarket-bets">
        <h2 className="text-2xl font-serif font-bold mb-6">Polymarket Bets</h2>
        <Card className="p-6 text-center border-dashed">
          <TrendingUp className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">
            No active prediction markets found for {personName}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-12" data-testid="section-polymarket-bets">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-serif font-bold">Polymarket Bets</h2>
        <Badge variant="outline" className="text-xs">
          <TrendingUp className="h-3 w-3 mr-1" />
          Live Markets
        </Badge>
      </div>

      <div className="space-y-3">
        {markets.map((market) => (
          <a
            key={market.id}
            href={getMarketUrl(market.slug)}
            target="_blank"
            rel="noopener noreferrer"
            className="block group"
            data-testid={`polymarket-bet-${market.id}`}
          >
            <Card className="p-4 hover:border-primary/50 hover:translate-y-[-2px] hover:shadow-md transition-all duration-200">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                    {market.question}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      {formatVolume(market.volume)} volume
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Ends {formatDate(market.endDate)}
                    </span>
                  </div>
                </div>
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
              </div>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
