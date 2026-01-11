import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/PersonAvatar";
import { RankBadge } from "@/components/RankBadge";
import { TrendBadge } from "@/components/TrendBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { AnimatedSentimentVotingWidget } from "@/components/AnimatedSentimentVotingWidget";
import { ArrowLeft } from "lucide-react";

interface VotingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPersonId?: string | null;
  peopleList?: TrendingPerson[];
}

export function VotingModal({ open, onOpenChange, initialPersonId, peopleList }: VotingModalProps) {
  const [, setLocation] = useLocation();
  const [selectedPerson, setSelectedPerson] = useState<TrendingPerson | null>(null);

  const { data: fetchedResponse, isLoading } = useQuery<{ data: TrendingPerson[], totalCount: number, hasMore: boolean }>({
    queryKey: ['/api/trending'],
    enabled: open && !peopleList,
  });

  // Use provided list or fetched list
  const people = peopleList || fetchedResponse?.data || [];

  // When modal opens with initialPersonId, auto-select that person
  useEffect(() => {
    if (open && initialPersonId && people.length > 0) {
      const person = people.find(p => p.id === initialPersonId);
      if (person) {
        setSelectedPerson(person);
      }
    }
  }, [open, initialPersonId, people]);

  const handlePersonClick = (person: TrendingPerson) => {
    setSelectedPerson(person);
  };

  const handleBackToList = () => {
    setSelectedPerson(null);
  };

  const handleVisitProfile = () => {
    if (selectedPerson) {
      onOpenChange(false);
      setSelectedPerson(null);
      setLocation(`/person/${selectedPerson.id}`);
    }
  };

  const handleVoteNext = () => {
    if (selectedPerson && people.length > 0) {
      const currentIndex = people.findIndex(p => p.id === selectedPerson.id);
      if (currentIndex !== -1 && currentIndex < people.length - 1) {
        const nextPerson = people[currentIndex + 1];
        setSelectedPerson(nextPerson);
      } else {
        // At end of list, go back to first person or close modal
        setSelectedPerson(people[0]);
      }
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedPerson(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]" data-testid="dialog-voting-modal">
        {selectedPerson ? (
          <>
            <DialogHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleBackToList}
                  data-testid="button-back-to-list"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <DialogTitle className="text-xl font-bold">Cast Your Vote</DialogTitle>
              </div>
              <DialogDescription className="sr-only">
                Rate {selectedPerson.name}
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="max-h-[calc(80vh-100px)]">
              <div className="pr-4 pb-8">
                <AnimatedSentimentVotingWidget
                  key={selectedPerson.id}
                  personId={selectedPerson.id}
                  personName={selectedPerson.name}
                  onVisitProfile={handleVisitProfile}
                  onVoteNext={handleVoteNext}
                />
              </div>
            </ScrollArea>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">Cast Your Vote</DialogTitle>
              <DialogDescription>
                Select a person to cast your sentiment vote
              </DialogDescription>
            </DialogHeader>
            
            <ScrollArea className="h-[500px] pr-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
                </div>
              ) : (
                <div className="space-y-2">
                  {people.map((person) => (
                    <div
                      key={person.id}
                      onClick={() => handlePersonClick(person)}
                      className="flex items-center gap-4 p-4 rounded-md hover-elevate active-elevate-2 cursor-pointer transition-all"
                      data-testid={`person-item-${person.id}`}
                    >
                      <RankBadge rank={person.rank} />
                      
                      <PersonAvatar
                        avatar={person.avatar}
                        name={person.name}
                        size="md"
                      />
                      
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-base truncate" data-testid={`text-person-name-${person.id}`}>
                          {person.name}
                        </h3>
                        {person.category && (
                          <Badge variant="secondary" className="text-xs">
                            {person.category}
                          </Badge>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-mono font-semibold" data-testid={`text-score-${person.id}`}>
                          {person.fameIndex ?? Math.round(person.trendScore / 10000)}
                        </span>
                        <TrendBadge value={person.change24h} size="sm" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
