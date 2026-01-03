import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Crown, ChevronDown, Search, Lock } from "lucide-react";
import { TrendingPerson } from "@shared/schema";

export interface WeeklyJackpotCardProps {
  onEnterJackpot: () => void;
  isMarketClosed?: boolean;
  timeRemaining: { days: number; hours: number; minutes: number; seconds: number };
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading?: boolean;
  compact?: boolean;
}

function CelebritySearchModal({
  open,
  onOpenChange,
  trendingPeople,
  selectedPerson,
  onSelectPerson,
  isLoading
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trendingPeople: TrendingPerson[];
  selectedPerson: TrendingPerson | null;
  onSelectPerson: (person: TrendingPerson) => void;
  isLoading: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  
  const filteredPeople = (trendingPeople || []).filter(person =>
    person.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectPerson = (person: TrendingPerson) => {
    onSelectPerson(person);
    onOpenChange(false);
    setSearchQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-4 pt-4 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Select Celebrity
          </DialogTitle>
          <DialogDescription>
            Choose who you want to predict for the Weekly Jackpot
          </DialogDescription>
        </DialogHeader>
        
        <div className="px-4 py-3 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              autoFocus
              data-testid="input-jackpot-search-modal"
            />
          </div>
        </div>
        
        <div className="h-[350px] overflow-y-auto">
          <div className="p-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-amber-500 border-r-transparent" />
              </div>
            ) : filteredPeople.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No results found</p>
            ) : (
              filteredPeople.map((person) => (
                <button
                  key={person.id}
                  onClick={() => handleSelectPerson(person)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors ${
                    selectedPerson?.id === person.id ? 'bg-amber-500/10 border border-amber-500/30' : ''
                  }`}
                  data-testid={`modal-option-person-${person.id}`}
                >
                  <PersonAvatar name={person.name} avatar={person.avatar || ""} size="sm" />
                  <div className="flex-1 text-left">
                    <p className="font-medium text-sm">{person.name}</p>
                    <p className="text-xs text-muted-foreground">Rank #{person.rank}</p>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(person.trendScore).toLocaleString()}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WeeklyJackpotCard({ 
  onEnterJackpot, 
  isMarketClosed = false,
  timeRemaining,
  trendingPeople,
  selectedPerson,
  onSelectPerson,
  isLoading = false,
  compact = false
}: WeeklyJackpotCardProps) {
  const [searchModalOpen, setSearchModalOpen] = useState(false);

  return (
    <div 
      className={`relative overflow-hidden rounded-2xl border-2 border-amber-500/50 ${compact ? 'mb-4' : 'mb-8'}`}
      style={{
        background: "linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(251, 146, 60, 0.05) 50%, transparent 100%)",
        boxShadow: "inset 0 0 30px rgba(245, 158, 11, 0.1), 0 0 40px rgba(245, 158, 11, 0.15)",
      }}
      data-testid="weekly-jackpot-card"
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-500/10 rounded-full blur-3xl" />
      
      <div className={`relative z-10 ${compact ? 'p-5' : 'p-6 md:p-8'}`}>
        <div className={`flex ${compact ? 'flex-col gap-4' : 'flex-col lg:flex-row items-start lg:items-center justify-between gap-6'}`}>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Crown className="h-5 w-5 text-amber-500" />
              <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/40">
                WEEKLY JACKPOT
              </Badge>
            </div>
            
            <div className="mb-4">
              <button
                onClick={() => setSearchModalOpen(true)}
                className={`w-full ${compact ? '' : 'max-w-md'} flex items-center justify-between gap-2 px-4 py-3 rounded-lg border-2 border-amber-500/40 bg-background/80 backdrop-blur-sm hover:border-amber-500/60 transition-colors`}
                data-testid="dropdown-jackpot-person"
              >
                <div className="flex items-center gap-3">
                  {selectedPerson ? (
                    <>
                      <PersonAvatar name={selectedPerson.name} avatar={selectedPerson.avatar || ""} size="sm" />
                      <div className="text-left">
                        <p className="font-semibold text-sm">{selectedPerson.name}</p>
                        <p className="text-xs text-muted-foreground">Rank #{selectedPerson.rank}</p>
                      </div>
                    </>
                  ) : (
                    <span className="text-muted-foreground text-sm">
                      {isLoading ? "Loading..." : "Select a celebrity to predict"}
                    </span>
                  )}
                </div>
                <ChevronDown className="h-5 w-5 text-amber-500" />
              </button>
            </div>
            
            <p className={`text-sm text-muted-foreground mb-4 ${compact ? '' : 'max-w-md'}`}>
              Predict the exact Trend Score at week's end. Closest wins the jackpot!
            </p>
            
            {isMarketClosed ? (
              <Button size={compact ? "default" : "lg"} className="bg-muted text-muted-foreground cursor-not-allowed w-full" disabled>
                <Lock className="h-5 w-5 mr-2" />
                Market Closed
              </Button>
            ) : (
              <Button 
                size={compact ? "default" : "lg"}
                className="bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/30 w-full"
                onClick={onEnterJackpot}
                disabled={!selectedPerson}
                data-testid="button-enter-jackpot"
              >
                <Crown className="h-5 w-5 mr-2" />
                Enter Jackpot
              </Button>
            )}
          </div>
          
          <div className={`flex ${compact ? 'flex-row justify-between items-center w-full pt-3 border-t border-amber-500/20' : 'flex-col items-end gap-2'}`}>
            <div className={compact ? '' : 'text-right'}>
              <p className="text-xs text-muted-foreground mb-1">Time Remaining</p>
              <div className="flex gap-2">
                {[
                  { value: timeRemaining.days, label: 'd' },
                  { value: timeRemaining.hours, label: 'h' },
                  { value: timeRemaining.minutes, label: 'm' },
                ].map((item, i) => (
                  <div key={i} className="flex items-baseline gap-0.5">
                    <span className={`font-mono font-bold text-amber-500 ${compact ? 'text-xl' : 'text-2xl'}`}>{item.value}</span>
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className={`text-sm font-semibold text-amber-500 ${compact ? '' : 'mt-2'}`}>
              Pool: 50,000+ credits
            </p>
          </div>
        </div>
      </div>
      
      <CelebritySearchModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        trendingPeople={trendingPeople}
        selectedPerson={selectedPerson}
        onSelectPerson={onSelectPerson}
        isLoading={isLoading}
      />
    </div>
  );
}
