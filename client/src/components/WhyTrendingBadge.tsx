import { Badge } from "@/components/ui/badge";
import { TouchTooltip } from "@/components/ui/touch-tooltip";
import { type TrendContext } from "@/hooks/useTrendContext";
import { AlertCircle, Circle, CheckCircle2 } from "lucide-react";

interface WhyTrendingBadgeProps {
  context: TrendContext | undefined;
  isLoading?: boolean;
  showHeadline?: boolean;
  compact?: boolean;
  size?: "sm" | "default";
}

function isSourceStale(timestamp: string | null): boolean {
  if (!timestamp) return true;
  const sourceTime = new Date(timestamp).getTime();
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  return sourceTime < oneHourAgo;
}

function getStaleStatus(sourceTimestamps: TrendContext["sourceTimestamps"]): {
  hasStale: boolean;
  staleSources: string[];
} {
  const staleSources: string[] = [];
  if (isSourceStale(sourceTimestamps.wiki)) staleSources.push("Wiki");
  if (isSourceStale(sourceTimestamps.news)) staleSources.push("News");
  if (isSourceStale(sourceTimestamps.search)) staleSources.push("Search");
  if (isSourceStale(sourceTimestamps.x)) staleSources.push("X");
  return {
    hasStale: staleSources.length > 0,
    staleSources,
  };
}

export function WhyTrendingBadge({ 
  context, 
  isLoading, 
  showHeadline = false,
  compact = false,
  size = "default"
}: WhyTrendingBadgeProps) {
  if (isLoading) {
    return (
      <Badge variant="outline" className="animate-pulse bg-muted/30 text-muted-foreground text-xs">
        Loading...
      </Badge>
    );
  }

  if (!context || !context.reasonTag) {
    return null;
  }

  const badgeContent = compact 
    ? context.reasonTag.split(" ")[0]
    : context.reasonTag;
    
  const staleStatus = context.sourceTimestamps 
    ? getStaleStatus(context.sourceTimestamps) 
    : { hasStale: false, staleSources: [] };

  const getBadgeStyle = () => {
    if (context.isHeated) {
      return "bg-orange-500/20 text-orange-300 border-orange-500/30";
    }
    
    switch (context.primaryDriver) {
      case "NEWS":
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
      case "SEARCH":
        return "bg-purple-500/20 text-purple-300 border-purple-500/30";
      case "SOCIAL":
        return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
      case "WIKI":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      default:
        return "bg-slate-500/20 text-slate-300 border-slate-500/30";
    }
  };

  const getSourceStatusIcon = (source: string) => {
    if (!context.sourceTimestamps) return null;
    const isStale = staleStatus.staleSources.includes(source);
    return isStale 
      ? <Circle className="h-2 w-2 text-muted-foreground" /> 
      : <CheckCircle2 className="h-2 w-2 text-emerald-500" />;
  };

  const tooltipContent = (
    <div className="max-w-xs space-y-2">
      <p className="font-semibold">{context.reasonTag}</p>
      {context.headlineSnippet && showHeadline && (
        <p className="text-xs text-muted-foreground italic">
          "{context.headlineSnippet}"
        </p>
      )}
      <div className="text-xs text-muted-foreground pt-1 border-t border-white/10">
        <p>Updated {context.lastScoredAtFormatted}</p>
        {context.sourceTimestampsFormatted && (
          <div className="mt-1 space-y-0.5">
            <p className="flex items-center gap-1">{getSourceStatusIcon("News")} News: {context.sourceTimestampsFormatted.news}</p>
            <p className="flex items-center gap-1">{getSourceStatusIcon("Search")} Search: {context.sourceTimestampsFormatted.search}</p>
            <p className="flex items-center gap-1">{getSourceStatusIcon("Wiki")} Wiki: {context.sourceTimestampsFormatted.wiki}</p>
            <p className="flex items-center gap-1">{getSourceStatusIcon("X")} X: {context.sourceTimestampsFormatted.x}</p>
          </div>
        )}
        {staleStatus.hasStale && staleStatus.staleSources.length >= 2 && (
          <p className="mt-2 text-amber-400/80 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Some sources may be cached
          </p>
        )}
      </div>
    </div>
  );

  const sizeClass = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs";
  
  return (
    <TouchTooltip
      content={tooltipContent}
      side="top"
      className="max-w-xs"
    >
      <span className="inline-flex cursor-help" data-testid="tooltip-trigger-why-trending">
        <Badge 
          variant="outline" 
          className={`${sizeClass} whitespace-nowrap ${getBadgeStyle()} ${
            staleStatus.hasStale && staleStatus.staleSources.length >= 3 ? "opacity-80" : ""
          }`}
          data-testid="badge-why-trending"
        >
          <span className="flex items-center gap-1">
            {badgeContent}
            {staleStatus.hasStale && staleStatus.staleSources.length >= 3 && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
              </span>
            )}
          </span>
        </Badge>
      </span>
    </TouchTooltip>
  );
}
