import { MarketCycleState } from "@/hooks/useMarketCycle";
import { Badge } from "@/components/ui/badge";

interface MarketCycleHeroProps {
  marketState: MarketCycleState;
}

function padZero(num: number): string {
  return num.toString().padStart(2, "0");
}

function TimerSegment({ value, label, testId }: { value: string; label: string; testId: string }) {
  return (
    <div 
      className="flex flex-col items-center justify-center bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 md:px-4 md:py-3 min-w-[52px] md:min-w-[64px] dark:bg-white/5 dark:border-white/10"
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

export function MarketCycleHero({ marketState }: MarketCycleHeroProps) {
  const { status, timeRemaining, urgencyLevel } = marketState;
  
  const getStatusBadge = () => {
    if (status === "CLOSED") {
      return (
        <Badge 
          className="px-3 py-1.5 text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/40"
          data-testid="status-badge-closed"
        >
          <span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-2" />
          LOCKED
        </Badge>
      );
    }
    
    switch (urgencyLevel) {
      case "critical":
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-red-500/20 text-red-400 border border-red-500/40"
            data-testid="status-badge-critical"
          >
            <span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-2 animate-pulse" />
            FINAL CALL
          </Badge>
        );
      case "warning":
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/40"
            data-testid="status-badge-warning"
          >
            <span className="inline-block w-2 h-2 bg-orange-400 rounded-full mr-2" />
            CLOSING SOON
          </Badge>
        );
      default:
        return (
          <Badge 
            className="px-3 py-1.5 text-xs font-semibold bg-green-500/20 text-green-400 border border-green-500/40"
            data-testid="status-badge-open"
          >
            <span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse" />
            OPEN
          </Badge>
        );
    }
  };
  
  return (
    <div 
      className="relative rounded-xl mb-6 border border-white/10 bg-card"
      data-testid="market-cycle-hero"
    >
      <div className="relative z-10 px-4 py-4 md:px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-400 text-[10px] font-medium uppercase tracking-widest">
            Weekly Market Closes In
          </p>
          
          <div 
            className="flex items-center gap-2"
            data-testid="countdown-timer"
          >
            <TimerSegment 
              value={padZero(timeRemaining.days)} 
              label="Days" 
              testId="timer-days" 
            />
            <span className="text-violet-500 text-lg font-bold">:</span>
            <TimerSegment 
              value={padZero(timeRemaining.hours)} 
              label="Hrs" 
              testId="timer-hours" 
            />
            <span className="text-violet-500 text-lg font-bold">:</span>
            <TimerSegment 
              value={padZero(timeRemaining.minutes)} 
              label="Min" 
              testId="timer-minutes" 
            />
            <span className="text-violet-500 text-lg font-bold">:</span>
            <TimerSegment 
              value={padZero(timeRemaining.seconds)} 
              label="Sec" 
              testId="timer-seconds" 
            />
          </div>
          
          <div className="flex items-center">
            {getStatusBadge()}
          </div>
        </div>
        
        {status === "CLOSED" && (
          <div className="mt-3 text-center">
            <p className="text-gray-400 text-xs">
              Markets are being resolved. New week opens soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
