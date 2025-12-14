import { MarketCycleState } from "@/hooks/useMarketCycle";
import { Badge } from "@/components/ui/badge";

interface MarketCycleHeroProps {
  marketState: MarketCycleState;
}

function padZero(num: number): string {
  return num.toString().padStart(2, "0");
}

export function MarketCycleHero({ marketState }: MarketCycleHeroProps) {
  const { status, timeRemaining, urgencyLevel } = marketState;
  
  const getBorderClass = () => {
    switch (urgencyLevel) {
      case "critical":
        return "border-red-500/60";
      case "warning":
        return "border-orange-500/60";
      default:
        return "border-violet-500/50";
    }
  };
  
  const getInsetGlow = () => {
    switch (urgencyLevel) {
      case "critical":
        return "inset 0 0 20px rgba(239, 68, 68, 0.15)";
      case "warning":
        return "inset 0 0 20px rgba(249, 115, 22, 0.15)";
      default:
        return "inset 0 0 20px rgba(139, 92, 246, 0.1)";
    }
  };
  
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
      className={`relative rounded-xl mb-6 border backdrop-blur-md bg-[#1a103c]/50 ${getBorderClass()}`}
      style={{
        boxShadow: getInsetGlow(),
      }}
      data-testid="market-cycle-hero"
    >
      <div className="relative z-10 px-4 py-4 md:px-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-violet-300/80 text-[10px] font-medium uppercase tracking-widest">
            Weekly Market Closes In
          </p>
          
          <div 
            className="font-mono text-2xl md:text-3xl font-bold tracking-wider text-gray-100"
            data-testid="countdown-timer"
          >
            <span data-testid="timer-days">{padZero(timeRemaining.days)}</span>
            <span className="text-violet-400/60 mx-1">:</span>
            <span data-testid="timer-hours">{padZero(timeRemaining.hours)}</span>
            <span className="text-violet-400/60 mx-1">:</span>
            <span data-testid="timer-minutes">{padZero(timeRemaining.minutes)}</span>
            <span className="text-violet-400/60 mx-1">:</span>
            <span data-testid="timer-seconds">{padZero(timeRemaining.seconds)}</span>
          </div>
          
          <div className="flex items-center">
            {getStatusBadge()}
          </div>
        </div>
        
        {status === "CLOSED" && (
          <div className="mt-3 text-center">
            <p className="text-violet-300/70 text-xs">
              Markets are being resolved. New week opens soon.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
