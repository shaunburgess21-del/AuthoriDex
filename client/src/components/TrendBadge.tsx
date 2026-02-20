import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TrendBadgeProps {
  value: number | null | undefined;
  size?: "sm" | "default" | "lg";
  showIcon?: boolean;
}

export function TrendBadge({ value, size = "default", showIcon = true }: TrendBadgeProps) {
  const sizeClass = size === "sm" ? "text-xs h-[33px]" : size === "lg" ? "text-base h-[41px]" : "text-sm h-[37px]";
  
  // Handle null/undefined values - display N/A
  if (value === null || value === undefined) {
    return (
      <Badge
        className={cn(
          "font-mono font-semibold px-2 gap-1 flex items-center",
          "bg-muted text-muted-foreground",
          sizeClass
        )}
        data-testid="badge-trend-na"
      >
        {showIcon && <Minus className="h-3 w-3" />}
        N/A
      </Badge>
    );
  }
  
  const isPositive = value > 0;
  const isNeutral = value === 0;
  
  const colorClass = isNeutral 
    ? "bg-trend-neutral text-trend-neutral-foreground" 
    : "";

  const glassStyle = isNeutral ? undefined : isPositive
    ? { backgroundColor: "rgba(0, 200, 83, 0.15)", borderColor: "rgba(0, 200, 83, 0.5)", color: "#00C853" }
    : { backgroundColor: "rgba(255, 0, 0, 0.15)", borderColor: "rgba(255, 0, 0, 0.5)", color: "#FF0000" };

  return (
    <Badge
      className={cn(
        "font-mono font-semibold px-2 gap-1 flex items-center",
        colorClass,
        sizeClass
      )}
      style={glassStyle}
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
