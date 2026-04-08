import { MarketCycleState } from "@/hooks/useMarketCycle";
import { Badge } from "@/components/ui/badge";

interface MarketCycleHeroProps {
  marketState: MarketCycleState;
  /** When true, do not break out to full viewport width (e.g. match profile page container width) */
  constrainedWidth?: boolean;
}

function padZero(num: number): string {
  return num.toString().padStart(2, "0");
}

function TimerSegment({ value, label, testId }: { value: string; label: string; testId: string }) {
  return (
    <div 
      className="flex flex-col items-center justify-center bg-slate-100 border border-slate-300 rounded-lg px-3 pt-[2px] pb-[2px] md:px-4 min-w-[52px] md:min-w-[64px] dark:bg-white/5 dark:border-white/10"
      data-testid={testId}
    >
      <span className="font-mono text-xl md:text-2xl font-bold text-slate-900 dark:text-white leading-none">
        {value}
      </span>
      <span className="text-[9px] md:text-[10px] uppercase tracking-widest text-slate-600 dark:text-gray-400 mt-1">
        {label}
      </span>
    </div>
  );
}

export function MarketCycleHero({ marketState, constrainedWidth = false }: MarketCycleHeroProps) {
  const { status, timeRemaining, urgencyLevel } = marketState;
  
  const getStatusBadge = () => {
    if (status === "RESOLVED") {
      return (
        <Badge 
          className="px-3 py-1.5 text-xs font-semibold bg-red-500/25 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/50 dark:border-red-500/40"
          data-testid="status-badge-closed"
        >
          <span className="inline-block w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full mr-2" />
          RESOLVED
        </Badge>
      );
    }

    if (status === "ENTRIES_CLOSED") {
      return (
        <Badge 
          className="px-3 py-1.5 text-xs font-semibold bg-amber-500/25 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/50 dark:border-amber-500/40"
          data-testid="status-badge-awaiting"
        >
          <span className="inline-block w-2 h-2 bg-amber-600 dark:bg-amber-400 rounded-full mr-2 animate-pulse" />
          AWAITING RESULTS
        </Badge>
      );
    }
    
    switch (urgencyLevel) {
      case "critical":
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-red-500/25 dark:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/50 dark:border-red-500/40"
            data-testid="status-badge-critical"
          >
            <span className="inline-block w-2 h-2 bg-red-600 dark:bg-red-400 rounded-full mr-2 animate-pulse" />
            FINAL CALL
          </Badge>
        );
      case "warning":
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-orange-500/25 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/50 dark:border-orange-500/40"
            data-testid="status-badge-warning"
          >
            <span className="inline-block w-2 h-2 bg-orange-600 dark:bg-orange-400 rounded-full mr-2" />
            CLOSING SOON
          </Badge>
        );
      default:
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-green-500/25 dark:bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/50 dark:border-green-500/40"
            data-testid="status-badge-open"
          >
            <span className="inline-block w-2 h-2 bg-green-600 dark:bg-green-400 rounded-full mr-2 animate-pulse" />
            OPEN
          </Badge>
        );
    }
  };

  const getLabel = () => {
    if (status === "RESOLVED") {
      return { desktop: "Market Resolved — New Week Monday", mobile: "Resolved" };
    }
    if (status === "ENTRIES_CLOSED") {
      return { desktop: "Results In", mobile: "Results In" };
    }
    return { desktop: "Betting Closes In", mobile: "Closes In" };
  };

  const label = getLabel();
  const showTimer = status !== "RESOLVED";
  
  return (
    <div 
      style={constrainedWidth ? undefined : { marginLeft: 'calc(-50vw + 50%)', marginRight: 'calc(-50vw + 50%)', paddingLeft: 'calc(50vw - 50%)', paddingRight: 'calc(50vw - 50%)' }}
      className="sticky top-16 z-[41] relative mb-6 border-y border-white/10 bg-card/95 backdrop-blur-sm"
      data-testid="market-cycle-hero"
    >
      <div className="relative z-10 px-4 py-2 md:px-6 md:py-4">
        <div className="flex flex-row items-center justify-between gap-2 md:gap-4">
          <p className="text-gray-600 dark:text-gray-400 text-[10px] font-medium uppercase tracking-widest hidden md:block">
            {label.desktop}
          </p>
          <p className="text-gray-600 dark:text-gray-400 text-[9px] font-medium uppercase tracking-widest md:hidden shrink-0">
            {label.mobile}
          </p>
          
          {showTimer && (
            <div 
              className="flex items-center gap-1.5 md:gap-2"
              data-testid="countdown-timer"
            >
              <TimerSegment 
                value={padZero(timeRemaining.days)} 
                label="Days" 
                testId="timer-days" 
              />
              <span className="text-violet-700 dark:text-violet-500 text-lg font-bold">:</span>
              <TimerSegment 
                value={padZero(timeRemaining.hours)} 
                label="Hrs" 
                testId="timer-hours" 
              />
              <span className="text-violet-700 dark:text-violet-500 text-lg font-bold">:</span>
              <TimerSegment 
                value={padZero(timeRemaining.minutes)} 
                label="Min" 
                testId="timer-minutes" 
              />
              <span className="text-violet-700 dark:text-violet-500 text-lg font-bold">:</span>
              <TimerSegment 
                value={padZero(timeRemaining.seconds)} 
                label="Sec" 
                testId="timer-seconds" 
              />
            </div>
          )}
          
          <div className="flex items-center">
            {getStatusBadge()}
          </div>
        </div>
      </div>
    </div>
  );
}
