import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/PersonAvatar";
import { RankBadge } from "@/components/RankBadge";
import { TrendBadge } from "@/components/TrendBadge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { TrendingPerson } from "@shared/schema";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";

interface VotingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VotingModal({ open, onOpenChange }: VotingModalProps) {
  const [, setLocation] = useLocation();

  const { data: people = [], isLoading } = useQuery<TrendingPerson[]>({
    queryKey: ['/api/trending'],
    enabled: open,
  });

  const handlePersonClick = (personId: string) => {
    onOpenChange(false);
    // Navigate with hash - PersonDetailPage will handle scrolling after data loads
    setLocation(`/person/${personId}#voting-widget`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]" data-testid="dialog-voting-modal">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Cast Your Vote</DialogTitle>
          <DialogDescription>
            Select a person to view their profile and cast your sentiment vote
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
                  onClick={() => handlePersonClick(person.id)}
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
                      {person.trendScore.toLocaleString()}
                    </span>
                    <TrendBadge value={person.change24h} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
