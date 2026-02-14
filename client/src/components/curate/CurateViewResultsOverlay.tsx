import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/CategoryPill";
import { PersonAvatar } from "@/components/PersonAvatar";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
}

interface CurateViewResultsOverlayProps {
  person: CuratePerson;
  onClose: () => void;
  onBack?: () => void;
}

export function CurateViewResultsOverlay({ 
  person, 
  onClose,
  onBack 
}: CurateViewResultsOverlayProps) {
  const [expandedImage, setExpandedImage] = useState<CelebrityImage | null>(null);
  const { toast } = useToast();

  const { data: images = [], isLoading } = useQuery<CelebrityImage[]>({
    queryKey: ['/api/people', person.id, 'images'],
  });

  const sortedImages = [...images].sort((a, b) => b.votesUp - a.votesUp);
  const totalVotes = images.reduce((sum, img) => sum + img.votesUp, 0);

  const voteMutation = useMutation({
    mutationFn: async ({ imageId }: { imageId: string }) => {
      const response = await apiRequest('POST', `/api/people/${person.id}/images/${imageId}/vote`, { direction: 'up' });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/people', person.id, 'images'] });
      toast({
        title: "Vote recorded!",
        description: "Your vote has been counted.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record vote",
        variant: "destructive",
      });
    },
  });

  const handleVote = (imageId: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
                data-testid="button-back-from-results"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            )}
            <PersonAvatar name={person.name} avatar={person.imageUrl || ""} size="md" />
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-serif font-bold">{person.name}</h2>
                <CategoryPill category={person.category} />
              </div>
              <span className="text-sm text-muted-foreground">
                {totalVotes.toLocaleString()} total votes
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
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
                
                return (
                  <motion.div 
                    key={image.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                      isLeading 
                        ? 'bg-cyan-500/10 border-cyan-500/30' 
                        : 'bg-muted/30 border-border hover:border-cyan-500/30'
                    }`}
                    data-testid={`view-results-image-${image.id}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      idx === 0 ? 'bg-yellow-500/20 text-yellow-300' :
                      idx === 1 ? 'bg-slate-400/20 text-slate-300' :
                      idx === 2 ? 'bg-orange-500/20 text-orange-300' :
                      'bg-slate-700/30 text-slate-400'
                    }`}>
                      {idx + 1}
                    </div>
                    
                    <button
                      onClick={() => setExpandedImage(image)}
                      className="relative h-16 w-16 rounded-lg overflow-hidden shrink-0 group cursor-pointer border border-slate-700/50 hover:border-cyan-500/50 transition-colors"
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
                          <Crown className="h-3.5 w-3.5 text-yellow-400" />
                        </div>
                      )}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-lg">{votePercent}%</span>
                        {isLeading && (
                          <span className="text-xs text-cyan-400 font-medium">Leading</span>
                        )}
                      </div>
                      <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
                        <motion.div 
                          className={`h-full ${isLeading ? 'bg-cyan-500' : 'bg-slate-500'}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${votePercent}%` }}
                          transition={{ duration: 0.5, delay: idx * 0.05 }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {image.votesUp.toLocaleString()} votes
                      </p>
                    </div>
                    
                    <Button
                      size="sm"
                      variant={isLeading ? "default" : "outline"}
                      onClick={(e) => handleVote(image.id, e)}
                      disabled={voteMutation.isPending}
                      className={isLeading ? "bg-cyan-500 hover:bg-cyan-600" : "border-cyan-500/50 text-cyan-400"}
                      data-testid={`button-vote-image-${image.id}`}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                      Vote
                    </Button>
                  </motion.div>
                );
              })}
            </div>
          )}
          
          <p className="text-center text-xs text-muted-foreground mt-6 max-w-md mx-auto">
            The photo with the most votes becomes the official profile image for {person.name} across AuthoriDex.
          </p>
        </div>
      </motion.div>

      <AnimatePresence>
        {expandedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setExpandedImage(null)}
            data-testid="image-lightbox"
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-white hover:bg-white/10"
              onClick={() => setExpandedImage(null)}
              data-testid="button-close-lightbox"
            >
              <X className="h-6 w-6" />
            </Button>
            
            <motion.img 
              src={expandedImage.imageUrl} 
              alt={`${person.name} expanded`}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            />
            
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-sm rounded-lg px-4 py-2">
              <span className="text-white font-medium">{expandedImage.votesUp.toLocaleString()} votes</span>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleVote(expandedImage.id, e);
                }}
                disabled={voteMutation.isPending}
                className="bg-cyan-500 hover:bg-cyan-600"
                data-testid="button-vote-lightbox"
              >
                <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                Vote for this look
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
