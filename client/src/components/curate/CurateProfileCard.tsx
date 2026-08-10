import { useState, useMemo, useEffect } from "react";
import { getDisplayImageUrl } from "@/lib/imageTransform";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InteractiveCategoryPill } from "@/components/InteractiveCategoryPill";
import { normalizeMarketCategory } from "@shared/constants";
import { PersonAvatar } from "@/components/PersonAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { isUnauthorizedApiError, signInToVoteToastOptions, signInToVoteTitle } from "@/lib/signInToVoteToast";
import { navigateToLogin } from "@/lib/authReturn";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Check, ChevronRight, Camera, Eye, RefreshCw, User } from "lucide-react";
import { selectCurateDisplayImages } from "./selectCurateDisplayImages";

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

export interface CuratePerson {
  id: string;
  name: string;
  category: string;
  imageUrl?: string | null;
}

interface CurateProfileCardProps {
  person: CuratePerson;
  onVote: () => void;
  onComplete: () => void;
  onViewResults: (person: CuratePerson) => void;
  showVisitProfileCta?: boolean;
  cycleNumber?: number;
  onFilterCategory?: (category: string) => void;
  categoryRaceMap?: Map<string, string>;
  leaderboardCategories?: Set<string>;
  onBrowseFullScreen?: () => void;
  categoryMenuDisabled?: boolean;
}

export function CurateProfileCard({
  person,
  onVote,
  onComplete,
  onViewResults,
  showVisitProfileCta = true,
  cycleNumber = 0,
  onFilterCategory,
  categoryRaceMap,
  leaderboardCategories,
  onBrowseFullScreen,
  categoryMenuDisabled = false,
}: CurateProfileCardProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [showShimmer, setShowShimmer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [isEditingVote, setIsEditingVote] = useState(false);
  const [isVotePending, setIsVotePending] = useState(false);
  const [resultMessage, setResultMessage] = useState<"recorded" | "saved">("recorded");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const imageQueryKey = useMemo(() => ["/api/people", person.id, "images"] as const, [person.id]);

  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: imageQueryKey,
  });

  const displayImages = useMemo(
    () => selectCurateDisplayImages(person.id, images, cycleNumber),
    [images, person.id, cycleNumber],
  );

  const persistedSelectedPhoto = useMemo(
    () => images.find((img) => img.currentUserDirection === 'up')?.id ?? null,
    [images]
  );

  const selectedImage = useMemo(
    () => images.find((img) => img.id === selectedPhoto) ?? null,
    [images, selectedPhoto]
  );

  useEffect(() => {
    if (isEditingVote || isVotePending) return;

    if (persistedSelectedPhoto) {
      setSelectedPhoto(persistedSelectedPhoto);
      setShowResults(true);
      setResultMessage("saved");
      return;
    }

    if (!showShimmer) {
      setSelectedPhoto(null);
      setShowResults(false);
      setResultMessage("recorded");
    }
  }, [persistedSelectedPhoto, isEditingVote, isVotePending, showShimmer]);

  const handleSelectPhoto = async (imageId: string) => {
    if (selectedPhoto || isVotePending) return;

    if (!user) {
      toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      return;
    }

    setSelectedPhoto(imageId);
    setShowShimmer(true);
    setIsVotePending(true);
    setResultMessage("recorded");

    try {
      const upRes = await apiRequest("POST", `/api/people/${person.id}/images/${imageId}/vote`, { direction: "up" });
      const upData = await upRes.json() as CurateImageVoteResponse;
      queryClient.setQueryData<CelebrityImage[]>(imageQueryKey, (currentImages) =>
        applyCurateVoteToImages(currentImages, imageId, upData)
      );
      setResultMessage(upData?.alreadyVoted ? "saved" : "recorded");
      setIsEditingVote(false);
      setShowShimmer(false);
      setShowResults(true);
      setIsVotePending(false);
      onVote();
      onComplete();
      void queryClient.invalidateQueries({ queryKey: imageQueryKey });
    } catch (error: unknown) {
      setShowShimmer(false);
      setIsVotePending(false);
      setSelectedPhoto(persistedSelectedPhoto);
      setShowResults(Boolean(persistedSelectedPhoto));
      setIsEditingVote(false);
      setResultMessage(persistedSelectedPhoto ? "saved" : "recorded");
      if (isUnauthorizedApiError(error)) {
        toast(signInToVoteTitle, signInToVoteToastOptions(() => navigateToLogin(setLocation)));
      } else {
        const message = error instanceof Error ? error.message : "Failed to record vote";
        toast.error("Error", { description: message });
      }
    }
  };

  const totalVotes = useMemo(() => {
    return images.reduce((sum, img) => sum + img.votesUp + img.votesDown, 0);
  }, [images]);

  const winningAvatar = useMemo(() => {
    const sorted = [...images].sort((a, b) => b.votesUp - a.votesUp);
    if (sorted.length > 0 && sorted[0].votesUp > 0) return sorted[0].imageUrl;
    return person.imageUrl || "";
  }, [images, person.imageUrl]);

  const hasVoted = selectedPhoto !== null;

  return (
    <div className="relative h-full w-full overflow-visible">
      <Card 
        className="hub-card-hover lb-row-neutral relative bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 dark:bg-none dark:bg-[#11151D] shadow-none md:shadow-sm rounded-[12px] md:rounded-xl h-full flex flex-col min-h-[390px] md:min-h-0"
        data-testid={`card-curate-${person.id}`}
      >
        <AnimatePresence>
          {showShimmer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 pointer-events-none overflow-hidden rounded-[12px] md:rounded-xl"
            >
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: '200%' }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                className="absolute inset-0 bg-gradient-to-r from-transparent via-green-400/30 to-transparent skew-x-12"
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute top-3 right-3 z-20">
          <InteractiveCategoryPill
            category={person.category}
            onFilter={() => onFilterCategory?.(person.category)}
            leaderboardCategories={leaderboardCategories}
            onBrowseFullScreen={onBrowseFullScreen}
            menuDisabled={categoryMenuDisabled}
          />
        </div>

        <div className="relative p-4 md:p-4 flex flex-col flex-1">
          <div className="flex items-center gap-3 mb-3">
            <PersonAvatar name={person.name} avatar={winningAvatar} size="md" />
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="font-semibold text-base truncate">{person.name}</h3>
              <span className={`text-xs ${hasVoted ? "text-muted-foreground" : "text-slate-600"}`}>
                {hasVoted ? `${totalVotes.toLocaleString('en-US')} votes` : "Votes"}
              </span>
            </div>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
            </div>
          ) : displayImages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Camera className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No images available</p>
            </div>
          ) : showResults ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center py-3">
              <p className="font-medium text-green-600 dark:text-green-400 mb-1">
                {resultMessage === "saved" ? "Your vote is saved!" : "Vote recorded!"}
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                {totalVotes.toLocaleString('en-US')} total votes
              </p>
              <motion.div
                initial={{ opacity: 0, scale: 0.94, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative w-full max-w-[210px] mb-4"
              >
                {selectedImage ? (
                  <div className="relative aspect-square overflow-hidden rounded-xl border border-slate-600/60 bg-slate-900/80 shadow-lg">
                    <img
                      src={getDisplayImageUrl(selectedImage.imageUrl, { width: 500 })}
                      alt={`${person.name} selected photo`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
                    <div className="absolute bottom-3 right-3 h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/40">
                      <Check className="h-5 w-5 text-white" />
                    </div>
                  </div>
                ) : (
                  <div className="aspect-square rounded-xl border border-slate-700/50 bg-slate-900/70 flex items-center justify-center">
                    <Camera className="h-10 w-10 text-slate-500" />
                  </div>
                )}
              </motion.div>
              <div className="flex flex-col gap-2 items-center">
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onViewResults(person)}
                    className="border-cyan-500/60 dark:border-cyan-500/50 text-cyan-600 dark:text-cyan-400"
                    data-testid={`button-view-results-${person.id}`}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    View Results
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelectedPhoto(null);
                      setShowResults(false);
                      setIsEditingVote(true);
                      setResultMessage("recorded");
                    }}
                    className="border-slate-600/50 text-slate-500 dark:text-slate-300 hover:text-white hover:border-slate-500"
                    data-testid={`button-change-vote-${person.id}`}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                    Change Vote
                  </Button>
                </div>
                {showVisitProfileCta && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setLocation(`/person/${person.id}`)}
                    className="text-muted-foreground hover:text-cyan-600 dark:hover:text-cyan-400 text-xs"
                    data-testid={`button-visit-profile-${person.id}`}
                  >
                    <User className="h-3 w-3 mr-1" />
                    Visit Profile
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">Which look best represents them?</p>
              
              <div className="grid grid-cols-2 gap-2">
                {displayImages.map((image) => {
                  const isSelected = selectedPhoto === image.id;
                  const votePercent = totalVotes > 0 
                    ? Math.round((image.votesUp / totalVotes) * 100) 
                    : 0;
                  
                  return (
                    <button
                      key={image.id}
                      onClick={() => handleSelectPhoto(image.id)}
                      disabled={hasVoted}
                      className={`relative aspect-square rounded-lg overflow-hidden border transition-all duration-300 ${
                        hasVoted
                          ? isSelected
                            ? 'border-slate-300/60 ring-2 ring-white/15'
                            : 'border-slate-700/30 opacity-70 hover:opacity-90 hover:border-slate-500/50 dark:border-slate-400/40'
                          : 'border-slate-700/50 hover:border-slate-400/50 cursor-pointer'
                      }`}
                      data-testid={`button-curate-photo-${image.id}`}
                    >
                      <img 
                        src={getDisplayImageUrl(image.imageUrl, { width: 400 })} 
                        alt={`${person.name} photo`}
                        className="w-full h-full object-cover"
                      />
                      {hasVoted && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                          <span className={`text-sm font-bold ${isSelected ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-600 dark:text-slate-400'}`}>
                            {votePercent}%
                          </span>
                        </div>
                      )}
                      {isSelected && (
                        <motion.div 
                          className="absolute inset-0 bg-green-500/25 dark:bg-green-500/20 flex items-center justify-center"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 20 }}
                            className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-lg shadow-green-500/40"
                          >
                            <Check className="h-5 w-5 text-white" />
                          </motion.div>
                        </motion.div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
