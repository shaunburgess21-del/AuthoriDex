import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { normalizeMarketCategory } from "@shared/constants";
import { PersonAvatar } from "@/components/PersonAvatar";
import { ImageLightbox } from "@/components/ImageLightbox";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { X, Crown, ThumbsUp, ChevronLeft, Maximize2, ZoomIn } from "lucide-react";
import type { CuratePerson } from "./CurateProfileCard";

interface CelebrityImage {
  id: string;
  personId: string;
  imageUrl: string;
  source: string | null;
  isPrimary: boolean;
  votesUp: number;
  votesDown: number;
  addedAt: string;
  currentUserDirection?: 'up' | 'down' | null;
}

type CurateImageVoteResponse = Partial<CelebrityImage> & {
  alreadyVoted?: boolean;
  swapped?: boolean;
};

function applyCurateVoteToImages(
  currentImages: CelebrityImage[] | undefined,
  imageId: string,
  voteData: CurateImageVoteResponse,
): CelebrityImage[] | undefined {
  if (!currentImages) return currentImages;

  const previousSelectedId = currentImages.find((img) => img.currentUserDirection === "up")?.id ?? null;

  return currentImages.map((img) => {
    if (img.id === imageId) {
      const defaultVotesUp = previousSelectedId === imageId ? img.votesUp : img.votesUp + (voteData.alreadyVoted ? 0 : 1);
      return {
        ...img,
        personId: voteData.personId ?? img.personId,
        imageUrl: voteData.imageUrl ?? img.imageUrl,
        source: voteData.source ?? img.source,
        isPrimary: typeof voteData.isPrimary === "boolean" ? voteData.isPrimary : img.isPrimary,
        addedAt: voteData.addedAt ?? img.addedAt,
        votesUp: typeof voteData.votesUp === "number" ? voteData.votesUp : defaultVotesUp,
        votesDown: typeof voteData.votesDown === "number" ? voteData.votesDown : img.votesDown,
        currentUserDirection: "up",
      };
    }

    if (img.id === previousSelectedId && previousSelectedId !== imageId) {
      return {
        ...img,
        votesUp: voteData.swapped ? Math.max(img.votesUp - 1, 0) : img.votesUp,
        currentUserDirection: null,
      };
    }

    return img.currentUserDirection === "up"
      ? { ...img, currentUserDirection: null }
      : img;
  });
}

interface CurateViewResultsOverlayProps {
  person: CuratePerson;
  onClose: () => void;
  onBack?: () => void;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
}

export function CurateViewResultsOverlay({ 
  person, 
  onClose,
  onBack,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
}: CurateViewResultsOverlayProps) {
  const [expandedImage, setExpandedImage] = useState<CelebrityImage | null>(null);
  const [pendingVoteImageId, setPendingVoteImageId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const imageQueryKey = useMemo(() => ['/api/people', person.id, 'images'] as const, [person.id]);

  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: imageQueryKey,
  });

  const sortedImages = [...images].sort((a, b) => b.votesUp - a.votesUp);
  const totalVotes = images.reduce((sum, img) => sum + img.votesUp, 0);
  const currentUserImageId = images.find((img) => img.currentUserDirection === 'up')?.id ?? null;
  const activeVotedImageId = pendingVoteImageId ?? currentUserImageId;
  const activeVoteButtonClassName = "border border-[#00C853]/50 bg-[#00C853]/10 text-[#00C853] hover:border-[#00C853]/80 hover:bg-[#00C853]/20";
  const inactiveVoteButtonClassName = "border border-border bg-muted/40 text-foreground dark:border-white/40 dark:bg-white/5 dark:text-white hover:border-cyan-500/80 hover:bg-cyan-500/25 hover:text-cyan-600 dark:hover:border-cyan-500/50 dark:hover:bg-cyan-500/20 dark:hover:text-cyan-400";

  const winningAvatar = useMemo(() => {
    if (sortedImages.length > 0 && sortedImages[0].votesUp > 0) return sortedImages[0].imageUrl;
    return person.imageUrl || "";
  }, [sortedImages, person.imageUrl]);

  const voteMutation = useMutation({
    mutationFn: async ({ imageId }: { imageId: string }) => {
      const response = await apiRequest('POST', `/api/people/${person.id}/images/${imageId}/vote`, { direction: 'up' });
      return response.json();
    },
    onMutate: ({ imageId }) => {
      setPendingVoteImageId(imageId);
    },
    onSuccess: (data: CurateImageVoteResponse, variables: { imageId: string }) => {
      queryClient.setQueryData<CelebrityImage[]>(imageQueryKey, (currentImages) =>
        applyCurateVoteToImages(currentImages, variables.imageId, data)
      );
      toast(data?.alreadyVoted ? "Vote saved!" : "Vote recorded!", { description: data?.alreadyVoted
          ? "This look is already your saved choice."
          : "Your vote has been counted." });
      void queryClient.invalidateQueries({ queryKey: imageQueryKey });
    },
    onError: (error: Error) => {
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else {
        toast.error("Error", { description: error.message || "Failed to record vote" });
      }
    },
    onSettled: () => {
      setPendingVoteImageId(null);
    },
  });

  const handleVote = (imageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (voteMutation.isPending) return;
    voteMutation.mutate({ imageId });
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack}
                aria-label="Go back"
                data-testid="button-back-from-results"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <PersonAvatar name={person.name} avatar={winningAvatar} size="md" />
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-serif font-bold">{person.name}</h2>
                <InteractiveCategoryPill
                  category={person.category}
                  onFilter={() => onFilterCategory?.(person.category)}
                  leaderboardCategories={leaderboardCategories}
                />
              </div>
              <span className="text-sm text-muted-foreground">
                {totalVotes.toLocaleString('en-US')} total votes
              </span>
              {activeVotedImageId && (
                <span className="text-xs text-cyan-600 dark:text-cyan-400">
                  {pendingVoteImageId ? "Saving your vote..." : "Your saved vote is highlighted below."}
                </span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            data-testid="button-close-view-results"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
            </div>
          ) : sortedImages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No images available for voting.</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl mx-auto">
              {sortedImages.map((image, idx) => {
                const votePercent = totalVotes > 0 
                  ? Math.round((image.votesUp / totalVotes) * 100) 
                  : 0;
                const isLeading = idx === 0;
                const isCurrentUserVote = activeVotedImageId === image.id;
                const isPendingVote = pendingVoteImageId === image.id;
                
                return (
                  <motion.div 
                    key={image.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                      isCurrentUserVote
                        ? 'bg-cyan-500/10 border-cyan-500/60'
                        : isLeading 
                        ? 'bg-white/5 border-slate-300/60' 
                        : 'bg-muted/30 border-border hover:border-slate-500/50 dark:border-slate-400/40'
                    }`}
                    data-testid={`view-results-image-${image.id}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      idx === 0 ? 'bg-yellow-500/25 dark:bg-yellow-500/20 text-yellow-600 dark:text-yellow-300' :
                      idx === 1 ? 'bg-slate-400/20 text-slate-500 dark:text-slate-300' :
                      idx === 2 ? 'bg-orange-500/25 dark:bg-orange-500/20 text-orange-600 dark:text-orange-300' :
                      'bg-muted/50 dark:bg-slate-700/30 text-muted-foreground dark:text-slate-400'
                    }`}>
                      {idx + 1}
                    </div>
                    
                    <button
                      onClick={() => setExpandedImage(image)}
                      className="relative h-16 w-16 rounded-lg overflow-hidden shrink-0 group cursor-pointer border border-slate-700/50 hover:border-slate-400/50 transition-colors"
                      aria-label={`Expand ${person.name} photo ${idx + 1}`}
                      data-testid={`button-expand-image-${image.id}`}
                    >
                      <img 
                        src={image.imageUrl} 
                        alt={`${person.name} photo ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <ZoomIn className="h-5 w-5 text-white" />
                      </div>
                      {isLeading && (
                        <div className="absolute top-1 right-1">
                          <Crown className="h-3.5 w-3.5 text-yellow-600 dark:text-yellow-400" />
                        </div>
                      )}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-lg">{votePercent}%</span>
                        {isCurrentUserVote && (
                          <span className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">
                            {isPendingVote ? "Saving..." : "Your vote"}
                          </span>
                        )}
                        {isLeading && (
                          <span className="text-xs text-cyan-600 dark:text-cyan-400 font-medium">Leading</span>
                        )}
                      </div>
                      <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
                        <motion.div 
                          className={`h-full ${isLeading ? 'bg-cyan-500' : 'bg-slate-500'}`}
                          initial={false}
                          animate={{ width: `${votePercent}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.05 }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {image.votesUp.toLocaleString('en-US')} votes
                      </p>
                    </div>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => handleVote(image.id, e)}
                      disabled={voteMutation.isPending}
                      className={isCurrentUserVote ? activeVoteButtonClassName : inactiveVoteButtonClassName}
                      data-testid={`button-vote-image-${image.id}`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                      {isPendingVote ? "Saving..." : isCurrentUserVote ? "Your vote" : "Vote"}
                    </Button>
                  </motion.div>
                );
              })}
            </div>
          )}
          
          <p className="text-center text-xs text-muted-foreground mt-6 max-w-md mx-auto">
            The photo with the most votes becomes the official profile image for {person.name} across VoxDex.
          </p>
        </div>
      </motion.div>

      <ImageLightbox
        open={!!expandedImage}
        src={expandedImage?.imageUrl ?? ""}
        alt={expandedImage ? `${person.name} expanded` : ""}
        onClose={() => setExpandedImage(null)}
        zIndexClass="z-[60]"
        testId="image-lightbox"
        closeButtonTestId="button-close-lightbox"
        footer={
          expandedImage ? (
            <div className="flex items-center gap-4 bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2">
              <span className="text-white font-medium">{expandedImage.votesUp.toLocaleString("en-US")} votes</span>
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleVote(expandedImage.id, e);
                }}
                disabled={voteMutation.isPending}
                className={activeVotedImageId === expandedImage.id ? activeVoteButtonClassName : inactiveVoteButtonClassName}
                data-testid="button-vote-lightbox"
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                {pendingVoteImageId === expandedImage.id
                  ? "Saving..."
                  : activeVotedImageId === expandedImage.id
                    ? "Your vote"
                    : "Vote for this look"}
              </Button>
            </div>
          ) : undefined
        }
      />
    </>
  );
}
