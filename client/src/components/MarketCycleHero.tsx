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
  
  const getTimerColorClass = () => {
    switch (urgencyLevel) {
      case "critical":
        return "text-red-500 animate-pulse";
      case "warning":
        return "text-orange-500";
      default:
        return "text-white";
    }
  };
  
  return (
    <div 
      className="relative overflow-hidden rounded-2xl mb-8"
      data-testid="market-cycle-hero"
    >
      <div 
        className="absolute inset-0 bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#8B5CF6] opacity-90"
      />
      
      <div className="absolute inset-0 bg-white/5 backdrop-blur-sm" />
      
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-1/4 w-64 h-64 bg-violet-400 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-fuchsia-400 rounded-full blur-3xl" />
      </div>
      
      <div className="relative z-10 px-6 py-8 md:px-8 md:py-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="hidden md:block w-1 h-12 bg-gradient-to-b from-violet-300 to-violet-500 rounded-full" />
            <div>
              <p className="text-violet-200 text-xs font-medium uppercase tracking-widest mb-1">
                Weekly Market Closes In
              </p>
              <p className="text-white/70 text-sm">
                All predictions lock at deadline
              </p>
            </div>
          </div>
          
          <div 
            className={`font-mono text-3xl md:text-5xl font-bold tracking-wider ${getTimerColorClass()}`}
            style={{
              textShadow: urgencyLevel === "critical" 
                ? "0 0 20px rgba(239, 68, 68, 0.5)" 
                : urgencyLevel === "warning"
                ? "0 0 20px rgba(249, 115, 22, 0.3)"
                : "0 0 20px rgba(139, 92, 246, 0.3)",
            }}
            data-testid="countdown-timer"
          >
            <span data-testid="timer-days">{padZero(timeRemaining.days)}</span>
            <span className="text-violet-300 mx-1">:</span>
            <span data-testid="timer-hours">{padZero(timeRemaining.hours)}</span>
            <span className="text-violet-300 mx-1">:</span>
            <span data-testid="timer-minutes">{padZero(timeRemaining.minutes)}</span>
            <span className="text-violet-300 mx-1">:</span>
            <span data-testid="timer-seconds">{padZero(timeRemaining.seconds)}</span>
          </div>
          
          <div className="flex items-center gap-2">
            {status === "OPEN" ? (
              <Badge 
                className="px-4 py-2 text-sm font-semibold bg-green-500/20 text-green-400 border border-green-500/40 backdrop-blur-sm"
                data-testid="status-badge-open"
              >
                <span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse" />
                OPEN
              </Badge>
            ) : (
              <Badge 
                className="px-4 py-2 text-sm font-semibold bg-red-500/20 text-red-400 border border-red-500/40 backdrop-blur-sm"
                data-testid="status-badge-closed"
              >
                <span className="inline-block w-2 h-2 bg-red-400 rounded-full mr-2" />
                LOCKED
              </Badge>
            )}
          </div>
        </div>
        
        {status === "CLOSED" && (
          <div className="mt-4 text-center">
            <p className="text-violet-200 text-sm">
              Markets are being resolved. New week opens soon.
            </p>
          </div>
        )}
      </div>
      
      <div 
        className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8B5CF6] via-[#A78BFA] to-[#8B5CF6]"
        style={{
          boxShadow: "0 0 20px rgba(139, 92, 246, 0.6)",
        }}
      />
    </div>
  );
}
