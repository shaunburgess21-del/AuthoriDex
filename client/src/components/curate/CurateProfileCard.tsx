import { useState, useMemo, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronRight, SkipForward, Camera, Eye, Maximize2 } from "lucide-react";

interface CelebrityImage {
  id: string;
  personId: string;
  imageUrl: string;
  source: string | null;
  isPrimary: boolean;
  votesUp: number;
  votesDown: number;
  addedAt: string;
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
  onSkip: () => void;
  onViewResults: (person: CuratePerson) => void;
  cycleNumber?: number;
}

export function CurateProfileCard({
  person,
  onVote,
  onComplete,
  onSkip,
  onViewResults,
  cycleNumber = 0,
}: CurateProfileCardProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [isExiting, setIsExiting] = useState(false);
  const [showShimmer, setShowShimmer] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef1 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', person.id, 'images'],
  });

  const displayImages = useMemo(() => {
    if (images.length < 4) return images;
    const seed = (person.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) + cycleNumber * 97) % 1000;
    const shuffled = [...images].sort((a, b) => {
      const hashA = ((a.id.charCodeAt(0) || 0) + seed) % 1000;
      const hashB = ((b.id.charCodeAt(0) || 0) + seed) % 1000;
      return hashA - hashB;
    });
    return shuffled.slice(0, 4);
  }, [images, person.id, cycleNumber]);

  const voteMutation = useMutation({
    mutationFn: async ({ imageId, direction }: { imageId: string; direction: 'up' | 'down' }) => {
      const response = await apiRequest('POST', `/api/people/${person.id}/images/${imageId}/vote`, { direction });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/people', person.id, 'images'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record vote",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    return () => {
      if (timeoutRef1.current) clearTimeout(timeoutRef1.current);
      if (timeoutRef2.current) clearTimeout(timeoutRef2.current);
    };
  }, []);

  const handleSelectPhoto = (imageId: string) => {
    if (selectedPhoto) return;
    
    setSelectedPhoto(imageId);
    setShowShimmer(true);
    onVote();
    
    voteMutation.mutate({ imageId, direction: 'up' });
    displayImages
      .filter(img => img.id !== imageId)
      .forEach(img => voteMutation.mutate({ imageId: img.id, direction: 'down' }));
    
    timeoutRef1.current = setTimeout(() => {
      setShowShimmer(false);
      setShowResults(true);
    }, 600);
  };

  const handleContinue = () => {
    setIsExiting(true);
    timeoutRef2.current = setTimeout(onComplete, 300);
  };

  const handleSkip = () => {
    setIsExiting(true);
    timeoutRef2.current = setTimeout(onSkip, 300);
  };

  const totalVotes = useMemo(() => {
    return images.reduce((sum, img) => sum + img.votesUp + img.votesDown, 0);
  }, [images]);

  const hasVoted = selectedPhoto !== null;

  return (
    <motion.div 
      className="w-full"
      initial={{ opacity: 1, x: 0 }}
      animate={{ opacity: isExiting ? 0 : 1, x: isExiting ? -100 : 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card 
        className="relative overflow-hidden bg-gradient-to-br from-slate-900/90 via-slate-800/90 to-slate-900/90 border border-slate-700/50"
        style={{ minHeight: '340px' }}
        data-testid={`card-curate-${person.id}`}
      >
        <AnimatePresence>
          {showShimmer && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 pointer-events-none"
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
          <CategoryPill category={person.category} />
        </div>

        <div className="relative p-4">
          <div className="flex items-center gap-3 mb-3">
            <PersonAvatar name={person.name} avatar={person.imageUrl || ""} size="md" />
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="font-semibold text-base truncate">{person.name}</h3>
              <span className="text-xs text-muted-foreground">
                {totalVotes.toLocaleString()} votes
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
              <Button 
                variant="ghost" 
                size="sm" 
                className="mt-2"
                onClick={handleSkip}
                data-testid={`button-skip-${person.id}`}
              >
                Skip <SkipForward className="h-3 w-3 ml-1" />
              </Button>
            </div>
          ) : showResults ? (
            <div className="text-center py-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3"
              >
                <Check className="h-6 w-6 text-green-400" />
              </motion.div>
              <p className="font-medium text-green-400 mb-1">Vote recorded!</p>
              <p className="text-xs text-muted-foreground mb-4">
                {totalVotes.toLocaleString()} total votes
              </p>
              <div className="flex gap-2 justify-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onViewResults(person)}
                  className="border-cyan-500/50 text-cyan-400"
                  data-testid={`button-view-results-${person.id}`}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  View Results
                </Button>
                <Button
                  size="sm"
                  onClick={handleContinue}
                  className="bg-cyan-500 hover:bg-cyan-600 text-white"
                  data-testid={`button-next-${person.id}`}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
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
                      className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                        hasVoted
                          ? isSelected
                            ? 'border-cyan-500 ring-2 ring-cyan-500/30'
                            : 'border-slate-700/30 opacity-50'
                          : 'border-slate-700/50 hover:border-cyan-500/50 cursor-pointer'
                      }`}
                      data-testid={`button-curate-photo-${image.id}`}
                    >
                      <img 
                        src={image.imageUrl} 
                        alt={`${person.name} photo`}
                        className="w-full h-full object-cover"
                      />
                      {hasVoted && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                          <span className={`text-sm font-bold ${isSelected ? 'text-cyan-400' : 'text-slate-400'}`}>
                            {votePercent}%
                          </span>
                        </div>
                      )}
                      {isSelected && (
                        <motion.div 
                          className="absolute inset-0 bg-green-500/20 flex items-center justify-center"
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
              
              {!hasVoted && (
                <div className="flex justify-center mt-3">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={handleSkip}
                    className="text-muted-foreground hover:text-foreground"
                    data-testid={`button-skip-${person.id}`}
                  >
                    Skip <SkipForward className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </motion.div>
  );
}
