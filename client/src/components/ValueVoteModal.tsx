import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { TrendingPerson } from "@shared/schema";
import { ArrowUp, ArrowDown, Loader2, Check } from "lucide-react";

interface ExtendedPerson extends TrendingPerson {
  approvalPct?: number | null;
  underratedPct?: number | null;
  overratedPct?: number | null;
  valueScore?: number | null;
  userValueVote?: string | null;
}

interface ValueVoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: ExtendedPerson | null;
}

export function ValueVoteModal({ open, onOpenChange, person }: ValueVoteModalProps) {
  const [localUserVote, setLocalUserVote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (person) {
      setLocalUserVote(person.userValueVote || null);
      setError(null);
      setSuccess(false);
    }
  }, [person]);

  const valueVoteMutation = useMutation({
    mutationFn: async (voteType: 'underrated' | 'overrated') => {
      if (!person) throw new Error("No person selected");
      return apiRequest('POST', `/api/celebrity/${person.id}/value-vote`, { vote: voteType });
    },
    onMutate: (voteType) => {
      setLocalUserVote(voteType);
      setError(null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/leaderboard'] });
      setSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
      }, 1000);
    },
    onError: (error: any) => {
      setLocalUserVote(person?.userValueVote || null);
      const errorMsg = error.message || "";
      if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
        setError("Please sign in to vote.");
      } else {
        setError("Couldn't submit vote. Please try again.");
      }
    },
  });

  const handleVote = (voteType: 'underrated' | 'overrated') => {
    valueVoteMutation.mutate(voteType);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setError(null);
      setSuccess(false);
    }
    onOpenChange(newOpen);
  };

  if (!person) return null;

  const isUnderrated = localUserVote === 'underrated';
  const isOverrated = localUserVote === 'overrated';
  const isPending = valueVoteMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md" data-testid="dialog-value-vote-modal">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-bold text-center">
            Is {person.name} Underrated or Overrated?
          </DialogTitle>
          <DialogDescription className="text-center text-muted-foreground">
            Your vote helps shape the Value leaderboard.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex flex-col items-center gap-6 py-4">
          <PersonAvatar
            avatar={person.avatar}
            name={person.name}
            size="lg"
          />
          
          <h3 className="font-semibold text-lg">{person.name}</h3>
          
          {success ? (
            <div className="flex items-center gap-2 text-emerald-500 font-medium">
              <Check className="h-5 w-5" />
              <span>Vote submitted!</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4 w-full">
              <button
                className={`flex items-center justify-center gap-3 w-full px-6 py-4 rounded-lg text-base font-semibold transition-all border-2 ${
                  isUnderrated 
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_16px_rgba(16,185,129,0.3)]" 
                    : "bg-emerald-500/5 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/15 hover:border-emerald-500/60"
                }`}
                onClick={() => handleVote('underrated')}
                disabled={isPending}
                data-testid="button-modal-underrated"
              >
                {isPending && localUserVote === 'underrated' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ArrowUp className="h-5 w-5" />
                    <span>Underrated</span>
                    {isUnderrated && <Check className="h-4 w-4 ml-auto" />}
                  </>
                )}
              </button>
              
              <button
                className={`flex items-center justify-center gap-3 w-full px-6 py-4 rounded-lg text-base font-semibold transition-all border-2 ${
                  isOverrated 
                    ? "bg-red-500/20 border-red-500 text-red-400 shadow-[0_0_16px_rgba(239,68,68,0.3)]" 
                    : "bg-red-500/5 border-red-500/40 text-red-500 hover:bg-red-500/15 hover:border-red-500/60"
                }`}
                onClick={() => handleVote('overrated')}
                disabled={isPending}
                data-testid="button-modal-overrated"
              >
                {isPending && localUserVote === 'overrated' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ArrowDown className="h-5 w-5" />
                    <span>Overrated</span>
                    {isOverrated && <Check className="h-4 w-4 ml-auto" />}
                  </>
                )}
              </button>
            </div>
          )}
          
          {error && (
            <p className="text-sm text-red-500 text-center" data-testid="text-vote-error">
              {error}
            </p>
          )}
          
          {localUserVote && !success && (
            <p className="text-sm text-muted-foreground text-center">
              You voted: <span className={localUserVote === 'underrated' ? 'text-emerald-500' : 'text-red-500'}>
                {localUserVote === 'underrated' ? 'Underrated' : 'Overrated'}
              </span>
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
