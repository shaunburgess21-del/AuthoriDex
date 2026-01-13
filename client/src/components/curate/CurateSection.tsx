import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import { ImageIcon, Eye, HelpCircle, RotateCcw } from "lucide-react";
import { CurateProfileCard, type CuratePerson } from "./CurateProfileCard";
import { CurateViewResultsOverlay } from "./CurateViewResultsOverlay";
import { CurateViewAllOverlay } from "./CurateViewAllOverlay";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FilterCategory } from "@shared/constants";

interface TrendingPerson {
  id: string;
  name: string;
  category: string;
  imageUrl: string | null;
  trendScore: number;
  rank: number;
}

interface CurateSectionProps {
  categoryFilter: FilterCategory;
  compact?: boolean;
}

export function CurateSection({ 
  categoryFilter,
  compact = false
}: CurateSectionProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [cycleNumber, setCycleNumber] = useState(0);
  const [votedPersonIds, setVotedPersonIds] = useState<Set<string>>(new Set());
  const [viewAllOpen, setViewAllOpen] = useState(false);
  const [viewResultsPerson, setViewResultsPerson] = useState<CuratePerson | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const { data: allCelebritiesResponse, isLoading } = useQuery<{ data: TrendingPerson[] } | TrendingPerson[]>({
    queryKey: ['/api/trending?sort=rank&limit=100'],
  });

  const allCelebrities = useMemo(() => {
    if (!allCelebritiesResponse) return [];
    const rawData = Array.isArray(allCelebritiesResponse) 
      ? allCelebritiesResponse 
      : (allCelebritiesResponse as { data: TrendingPerson[] }).data;
    const data = Array.isArray(rawData) ? rawData : [];
    return data.filter((p): p is TrendingPerson => !!p && !!p.id);
  }, [allCelebritiesResponse]);

  const filteredCelebrities = useMemo(() => {
    if (categoryFilter === "All") return allCelebrities;
    if (categoryFilter === "Favorites") return allCelebrities;
    return allCelebrities.filter(
      person => person.category?.toLowerCase() === categoryFilter.toLowerCase()
    );
  }, [allCelebrities, categoryFilter]);

  const currentPerson: CuratePerson | null = useMemo(() => {
    if (filteredCelebrities.length === 0) return null;
    const safeIndex = currentIndex % filteredCelebrities.length;
    const person = filteredCelebrities[safeIndex];
    if (!person || !person.id) return null;
    return {
      id: person.id,
      name: person.name || 'Unknown',
      category: person.category || 'Entertainment',
      imageUrl: person.imageUrl,
    };
  }, [filteredCelebrities, currentIndex]);

  const handleVote = useCallback(() => {
    if (currentPerson) {
      setVotedPersonIds(prev => new Set(Array.from(prev).concat(currentPerson.id)));
    }
  }, [currentPerson]);

  const handleComplete = useCallback(() => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= filteredCelebrities.length) {
      setCycleNumber(prev => prev + 1);
      setCurrentIndex(0);
    } else {
      setCurrentIndex(nextIndex);
    }
  }, [currentIndex, filteredCelebrities.length]);

  const handleSkip = useCallback(() => {
    handleComplete();
  }, [handleComplete]);

  const handleViewResults = useCallback((person: CuratePerson) => {
    setViewResultsPerson(person);
  }, []);

  const handleSelectFromViewAll = useCallback((person: CuratePerson) => {
    const idx = filteredCelebrities.findIndex(p => p.id === person.id);
    if (idx >= 0) {
      setCurrentIndex(idx);
    }
    setViewAllOpen(false);
    setViewResultsPerson(person);
  }, [filteredCelebrities]);

  const handleStartOver = useCallback(() => {
    setCycleNumber(prev => prev + 1);
    setCurrentIndex(0);
  }, []);

  const progress = filteredCelebrities.length > 0 
    ? Math.min(currentIndex + 1, filteredCelebrities.length)
    : 0;
  const total = filteredCelebrities.length;
  const isComplete = currentIndex >= filteredCelebrities.length && filteredCelebrities.length > 0;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold">Curate Profile</h3>
            <Tooltip>
              <TooltipTrigger asChild>
                <button 
                  onClick={() => setRulesOpen(true)}
                  className="text-muted-foreground hover:text-foreground"
                  data-testid="button-curate-help"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>How it works</TooltipContent>
            </Tooltip>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewAllOpen(true)}
            className="text-cyan-400 hover:text-cyan-300"
            data-testid="button-view-all-curate"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            View All
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
          </div>
        ) : filteredCelebrities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg border border-border">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No celebrities match this filter</p>
          </div>
        ) : isComplete ? (
          <div className="text-center py-8 bg-muted/20 rounded-lg border border-border">
            <div className="h-12 w-12 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto mb-3">
              <RotateCcw className="h-6 w-6 text-cyan-400" />
            </div>
            <p className="font-medium text-cyan-400 mb-1">All caught up!</p>
            <p className="text-sm text-muted-foreground mb-4">
              You've seen all {total} celebrities in this category
            </p>
            <Button
              size="sm"
              onClick={handleStartOver}
              className="bg-cyan-500 hover:bg-cyan-600"
              data-testid="button-start-over"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Start Over (New Photos)
            </Button>
          </div>
        ) : currentPerson ? (
          <>
            <div className="text-center text-xs text-muted-foreground mb-2">
              {progress} of {total}
              {cycleNumber > 0 && (
                <span className="ml-2 text-cyan-400">(Round {cycleNumber + 1})</span>
              )}
            </div>
            
            <CurateProfileCard
              key={`${currentPerson.id}-${cycleNumber}`}
              person={currentPerson}
              onVote={handleVote}
              onComplete={handleComplete}
              onSkip={handleSkip}
              onViewResults={handleViewResults}
              cycleNumber={cycleNumber}
            />
            
            <div className="flex justify-center gap-1 mt-2">
              {Array.from({ length: Math.min(5, total) }).map((_, i) => {
                const isActive = i === (currentIndex % Math.min(5, total));
                return (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      isActive 
                        ? 'w-4 bg-cyan-500' 
                        : 'w-1.5 bg-slate-600'
                    }`}
                  />
                );
              })}
              {total > 5 && (
                <span className="text-xs text-muted-foreground ml-1">+{total - 5}</span>
              )}
            </div>
          </>
        ) : null}
      </div>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Curate Profile Rules</DialogTitle>
            <DialogDescription>
              Which image best represents this celebrity? The winning look becomes the primary 
              profile image across the entire platform. Only the highest quality looks make it 
              to the index.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>• Vote on which photo best represents each celebrity</p>
            <p>• The photo with the most votes becomes their official profile image</p>
            <p>• Skip celebrities you don't want to vote on</p>
            <p>• Use "View All" to browse all celebrities at once</p>
            <p>• Use "View Results" to see current rankings for any celebrity</p>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {viewAllOpen && (
          <CurateViewAllOverlay
            onClose={() => setViewAllOpen(false)}
            onSelectPerson={handleSelectFromViewAll}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewResultsPerson && (
          <CurateViewResultsOverlay
            person={viewResultsPerson}
            onClose={() => setViewResultsPerson(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
