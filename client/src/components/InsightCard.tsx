import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

interface InsightCardProps {
  insightType: string;
  metricName: string;
  topItem: {
    rank: number;
    title: string;
    metricValue: number;
    link?: string;
    imageUrl?: string;
    timestamp: Date;
  };
  onClick: () => void;
}

function formatMetricValue(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function InsightCard({ insightType, metricName, topItem, onClick }: InsightCardProps) {
  return (
    <Card 
      className="cursor-pointer hover-elevate active-elevate-2 overflow-visible" 
      onClick={onClick}
      data-testid={`card-insight-${insightType.toLowerCase().replace(/\s+/g, '-')}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              {insightType}
            </h4>
            <p className="text-sm font-medium leading-tight line-clamp-2" data-testid="text-insight-title">
              {topItem.title}
            </p>
          </div>
          <Badge variant="secondary" className="flex-shrink-0 gap-1">
            <TrendingUp className="h-3 w-3" />
            #{topItem.rank}
          </Badge>
        </div>
        
        <div className="flex items-center gap-2 mt-3">
          <span className="text-lg font-mono font-bold" data-testid="text-insight-metric">
            {formatMetricValue(topItem.metricValue)}
          </span>
          <span className="text-sm text-muted-foreground">
            {metricName}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
