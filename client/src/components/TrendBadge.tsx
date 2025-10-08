import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TrendBadgeProps {
  value: number;
  size?: "sm" | "default" | "lg";
  showIcon?: boolean;
}

export function TrendBadge({ value, size = "default", showIcon = true }: TrendBadgeProps) {
  const isPositive = value > 0;
  const isNeutral = value === 0;
  
  const colorClass = isNeutral 
    ? "bg-trend-neutral text-trend-neutral-foreground" 
    : isPositive 
    ? "bg-trend-up text-trend-up-foreground" 
    : "bg-trend-down text-trend-down-foreground";

  const sizeClass = size === "sm" ? "text-xs h-5" : size === "lg" ? "text-base h-7" : "text-sm h-6";

  return (
    <Badge
      className={cn(
        "font-mono font-semibold px-2 gap-1 flex items-center",
        colorClass,
        sizeClass
      )}
      data-testid={`badge-trend-${isPositive ? 'up' : isNeutral ? 'neutral' : 'down'}`}
    >
      {showIcon && (
        <>
          {isNeutral ? (
            <Minus className="h-3 w-3" />
          ) : isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
        </>
      )}
      {isPositive ? "+" : ""}{value.toFixed(2)}%
    </Badge>
  );
}
