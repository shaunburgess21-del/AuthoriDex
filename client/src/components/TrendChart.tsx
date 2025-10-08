import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

type TimeRange = "1D" | "7D" | "30D" | "ALL";

interface TrendChartProps {
  personName: string;
}

export function TrendChart({ personName }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("7D");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-lg font-serif">Trend History</CardTitle>
        <div className="flex gap-2">
          {(["1D", "7D", "30D", "ALL"] as TimeRange[]).map((range) => (
            <Button
              key={range}
              variant={timeRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setTimeRange(range)}
              className="text-xs"
              data-testid={`button-timerange-${range}`}
            >
              {range}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-64 flex items-center justify-center border rounded-lg bg-muted/20">
          <div className="text-center">
            <p className="text-muted-foreground font-mono">
              Chart for {personName} ({timeRange})
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Chart visualization would appear here
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
