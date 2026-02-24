import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { useLocation } from "wouter";
import { ArrowLeft, Users, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface AnimatedSentimentVotingWidgetProps {
  personId: string;
  personName: string;
  onVisitProfile?: () => void;
  onVoteNext?: () => void;
  isProfilePage?: boolean;
}

const ZONE_LABELS = ['Hate', 'Dislike', 'Neutral', 'Like', 'Love'];

const SEGMENT_COLORS = [
  { bg: '#FF0000', glow: '#FF0000' },
  { bg: '#FF6D00', glow: '#FF6D00' },
  { bg: '#FFC400', glow: '#FFC400' },
  { bg: '#76FF03', glow: '#76FF03' },
  { bg: '#00C853', glow: '#00C853' },
];

const ZONE_COLORS = {
  'Hate': '#FF0000',
  'Dislike': '#FF6D00',
  'Neutral': '#FFC400',
  'Like': '#76FF03',
  'Love': '#00C853',
};

const getZoneLabel = (value: number) => {
  return ZONE_LABELS[value - 1] || ZONE_LABELS[2];
};

const getApprovalMessage = (value: number, personName: string) => {
  if (value === 1) return `You strongly disapprove of ${personName}!`;
  if (value === 2) return `You disapprove of ${personName}.`;
  if (value === 3) return `You have a neutral opinion about ${personName}.`;
  if (value === 4) return `You approve of ${personName}.`;
  return `You strongly approve of ${personName}!`;
};

interface SentimentStats {
  totalVotes: number;
  averageRating: number;
  distribution: Record<string, number>;
}

interface CommunityResultsViewProps {
  personName: string;
  personId: string;
  userVote: number;
  onBackToVoting: () => void;
}

function CommunityResultsView({ personName, personId, userVote, onBackToVoting }: CommunityResultsViewProps) {
  const { data: stats, isLoading } = useQuery<SentimentStats>({
    queryKey: ['/api/celebrity', personId, 'sentiment-stats'],
    queryFn: async () => {
      const response = await fetch(`/api/celebrity/${personId}/sentiment-stats`);
      if (!response.ok) throw new Error('Failed to fetch sentiment stats');
      return response.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const defaultStats: SentimentStats = {
    totalVotes: 0,
    averageRating: 3.0,
    distribution: { Hate: 10, Dislike: 15, Neutral: 30, Like: 25, Love: 20 }
  };

  const displayStats = stats || defaultStats;
  const maxPercent = Math.max(...Object.values(displayStats.distribution));
  
  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-12 space-y-4"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading community results...</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
      data-testid="community-results-view"
    >
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBackToVoting}
          className="gap-2"
          data-testid="button-back-to-voting"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Voting
        </Button>
      </div>

      <div className="text-center">
        <h3 
          className="text-xl font-bold mb-1"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          Community Sentiment
        </h3>
        <p className="text-sm text-muted-foreground">
          How the community feels about {personName}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Total Votes</span>
          </div>
          <p className="text-2xl font-bold" data-testid="text-total-votes">
            {displayStats.totalVotes.toLocaleString('en-US')}
          </p>
        </div>
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className="text-sm text-muted-foreground mb-1">Average Rating</div>
          <p 
            className="text-2xl font-bold"
            style={{ color: SEGMENT_COLORS[Math.round(displayStats.averageRating) - 1]?.bg || '#888' }}
            data-testid="text-average-rating"
          >
            {displayStats.averageRating}/5
          </p>
          <p className="text-xs text-muted-foreground">
            {getZoneLabel(Math.round(displayStats.averageRating))}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Sentiment Distribution
        </h4>
        {ZONE_LABELS.map((zone) => {
          const percent = displayStats.distribution[zone] || 0;
          const isUserZone = getZoneLabel(userVote) === zone;
          const color = ZONE_COLORS[zone as keyof typeof ZONE_COLORS];
          
          return (
            <div key={zone} className="space-y-1" data-testid={`zone-bar-${zone.toLowerCase()}`}>
              <div className="flex items-center justify-between text-sm">
                <span className={`font-medium ${isUserZone ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {zone}
                  {isUserZone && (
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                      Your vote
                    </span>
                  )}
                </span>
                <span className="font-mono text-muted-foreground">{percent}%</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ 
                    backgroundColor: color,
                    boxShadow: `0 0 8px ${color}40`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(percent / maxPercent) * 100}%` }}
                  transition={{ duration: 0.5, delay: ZONE_LABELS.indexOf(zone) * 0.1 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-border">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>Your Vote:</span>
          <span 
            className="font-bold"
            style={{ color: SEGMENT_COLORS[userVote - 1]?.bg || '#888' }}
          >
            {userVote}/5 - {getZoneLabel(userVote)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function AnimatedSentimentVotingWidget({ 
  personId, 
  personName, 
  onVisitProfile,
  onVoteNext,
  isProfilePage = false 
}: AnimatedSentimentVotingWidgetProps) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showingResults, setShowingResults] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const savedVote = localStorage.getItem(`sentiment-vote-${personId}`);
    if (savedVote) {
      setCurrentValue(parseInt(savedVote, 10));
      setIsSubmitted(true);
    }
  }, [personId]);

  const handleSegmentClick = (segmentValue: number) => {
    setCurrentValue(segmentValue);
    setHasInteracted(true);
  };

  const handleVoteSubmit = async () => {
    if (!currentValue) return;

    setIsSubmitted(true);
    localStorage.setItem(`sentiment-vote-${personId}`, currentValue.toString());

    try {
      localStorage.setItem("authoridex-has-ever-voted", "1");
    } catch {}
    window.dispatchEvent(new CustomEvent('authoridex-ever-voted'));
    
    window.dispatchEvent(new CustomEvent('sentiment-vote-updated', {
      detail: { personId, value: currentValue }
    }));
    
    if (user) {
      try {
        const supabase = await getSupabase();
        const { error } = await supabase
          .from('user_votes')
          .upsert({
            userId: user.id,
            personId,
            personName,
            rating: currentValue,
          }, {
            onConflict: 'userId,personId',
          });

        if (error) {
          console.error('Error saving vote to Supabase:', error);
        } else {
          console.log('Vote saved to Supabase');
        }
      } catch (error) {
        console.error('Error connecting to Supabase:', error);
      }
    }
    
    console.log('[Telemetry] ui.vote_submitted', { 
      personId, 
      value: currentValue,
      zone: getZoneLabel(currentValue),
      savedToSupabase: !!user
    });
    
    toast({
      title: "Vote Submitted",
      description: `You rated ${personName} as ${getZoneLabel(currentValue)}`,
    });
  };

  const handleVisitProfile = () => {
    if (onVisitProfile) {
      onVisitProfile();
    } else {
      setLocation(`/person/${personId}`);
    }
  };

  const handleViewResults = () => {
    setShowingResults(true);
  };

  const handleBackToVoting = () => {
    setShowingResults(false);
  };

  const displayValue = currentValue || 3;
  const activeZone = getZoneLabel(displayValue);

  return (
    <div 
      className="w-full bg-card border border-border rounded-2xl p-4 sm:p-6 md:p-8"
      data-testid="sentiment-voting-widget"
    >
      <AnimatePresence mode="wait">
        {showingResults && currentValue ? (
          <CommunityResultsView
            key="results"
            personName={personName}
            personId={personId}
            userVote={currentValue}
            onBackToVoting={handleBackToVoting}
          />
        ) : (
          <motion.div
            key="voting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="text-center mb-3">
              <h3 
                className="text-2xl font-bold mb-2"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Rate {personName}
              </h3>
              <p className="text-muted-foreground w-full">
                How do you feel about <span className="text-foreground font-semibold">{personName}</span>?
              </p>
            </div>

            <div className="space-y-4">
              <div className="relative mb-2 h-16 flex items-center pointer-events-none">
                {ZONE_LABELS.map((label, index) => {
                  const isActive = activeZone === label;
                  const labelPosition = (index + 0.5) / 5;
                  
                  return (
                    <motion.div
                      key={label}
                      className="relative"
                      style={{ 
                        position: 'absolute',
                        left: `${labelPosition * 100}%`,
                        transform: 'translateX(-50%)'
                      }}
                      animate={{
                        filter: isActive
                          ? "drop-shadow(0 0 12px rgba(255,255,255,0.6)) drop-shadow(0 0 24px rgba(255,255,255,0.3))"
                          : "drop-shadow(0 0 0px rgba(255,255,255,0))",
                      }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className={`
                        px-3 sm:px-4 py-2 rounded-xl border transition-all duration-300 text-sm sm:text-base
                        ${isActive 
                          ? 'bg-card text-foreground border-border scale-110' 
                          : 'bg-transparent text-muted-foreground border-border/50'
                        }
                      `}>
                        {label}
                      </div>
                      {isActive && (
                        <div 
                          className="absolute left-1/2 -translate-x-1/2 -bottom-2 transition-all duration-300 bg-card"
                          style={{
                            width: '16px',
                            height: '16px',
                            clipPath: 'polygon(50% 100%, 0% 0%, 100% 0%)',
                            filter: 'drop-shadow(0 4px 8px rgba(255, 255, 255, 0.15))'
                          }}
                        />
                      )}
                    </motion.div>
                  );
                })}
              </div>

              <div className="relative px-2">
                <div className="flex justify-between gap-2 absolute inset-x-2 -top-16 -bottom-20 pointer-events-none">
                  {[1, 2, 3, 4, 5].map((value) => {
                    return (
                      <div
                        key={value}
                        className="flex-1 cursor-pointer pointer-events-auto"
                        onClick={() => handleSegmentClick(value)}
                        data-testid={`segment-column-${value}`}
                      />
                    );
                  })}
                </div>
                
                <div className="flex justify-between gap-2">
                  {[1, 2, 3, 4, 5].map((value) => {
                    const isActive = value === displayValue;
                    const isFilled = value <= displayValue;
                    const color = SEGMENT_COLORS[value - 1];
                    
                    return (
                      <div
                        key={value}
                        className="flex-1 flex flex-col items-center cursor-pointer"
                        onClick={() => handleSegmentClick(value)}
                        tabIndex={0}
                        role="button"
                        aria-label={`Select ${value} out of 5 - ${ZONE_LABELS[value - 1]}`}
                        data-testid={`segment-${value}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSegmentClick(value);
                          }
                        }}
                      >
                        <div className="h-4" />
                        <motion.div
                          className="w-full h-5 rounded-full cursor-pointer"
                          style={{
                            backgroundColor: color.bg,
                            opacity: isFilled ? 1 : 0.4,
                            boxShadow: isFilled 
                              ? `0 0 10px ${color.glow}60, 0 2px 4px rgba(0,0,0,0.3)`
                              : 'none',
                          }}
                          animate={{
                            scale: isActive ? 1.08 : 1,
                          }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        />
                      </div>
                    );
                  })}
                </div>

                {currentValue && (
                  <motion.div
                    className="absolute pointer-events-none z-10"
                    data-testid="vote-needle"
                    style={{
                      top: '-18px',
                    }}
                    initial={{ opacity: 0, scale: 0, left: `calc(0.5rem + (100% - 1rem) * ${(displayValue - 0.5) / 5})` }}
                    animate={{ 
                      opacity: 1, 
                      scale: 1,
                      left: `calc(0.5rem + (100% - 1rem) * ${(displayValue - 0.5) / 5})`,
                      x: '-50%'
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="flex flex-col items-center pointer-events-none">
                      <motion.div
                        className="w-1 rounded-full pointer-events-none"
                        data-testid="needle-line"
                        style={{
                          height: '55px',
                          backgroundColor: SEGMENT_COLORS[displayValue - 1]?.bg,
                          boxShadow: `0 0 12px ${SEGMENT_COLORS[displayValue - 1]?.glow}60`,
                        }}
                        animate={{
                          scaleY: isDragging ? 1.1 : 1,
                        }}
                      />
                      <motion.div
                        className="w-6 h-6 rounded-full pointer-events-none"
                        data-testid="needle-circle"
                        style={{
                          backgroundColor: SEGMENT_COLORS[displayValue - 1]?.bg,
                          borderWidth: '3px',
                          borderStyle: 'solid',
                          borderColor: '#ffffff',
                          boxShadow: `0 0 16px ${SEGMENT_COLORS[displayValue - 1]?.glow}70, 0 4px 8px rgba(0,0,0,0.3)`,
                        }}
                        animate={{
                          scale: isDragging ? 1.15 : 1,
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="flex justify-between gap-2 px-2 mt-[16px] mb-[8px]">
                {[1, 2, 3, 4, 5].map((num) => (
                  <div
                    key={num}
                    className={`flex-1 text-center text-muted-foreground mt-[4px] mb-[4px] ${
                      num === displayValue ? 'font-bold text-[18px]' : 'font-medium text-[16px]'
                    }`}
                    data-testid={`number-label-${num}`}
                  >
                    {num}
                  </div>
                ))}
              </div>

              <AnimatePresence mode="wait">
                {!isSubmitted ? (
                  <motion.div
                    key="submit-button"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.3 }}
                    className="pt-2"
                  >
                    <Button
                      onClick={handleVoteSubmit}
                      disabled={!hasInteracted}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400/30 text-white shadow-lg shadow-blue-500/20"
                      size="lg"
                      data-testid="button-submit-vote"
                    >
                      {hasInteracted ? "Submit Your Vote" : "Select a Rating"}
                    </Button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="feedback-section"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="text-center space-y-3 pt-2"
                  >
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-foreground">
                        Your Vote: {displayValue}/5 - {activeZone}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {getApprovalMessage(displayValue, personName)}
                      </p>
                    </div>

                    {isProfilePage ? (
                      <Button
                        onClick={handleViewResults}
                        className="w-full"
                        size="lg"
                        data-testid="button-view-results"
                      >
                        View Results
                      </Button>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3">
                        <Button
                          onClick={onVoteNext}
                          className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400/30 text-white shadow-lg shadow-blue-500/20"
                          size="lg"
                          data-testid="button-vote-next"
                        >
                          Vote Next
                        </Button>
                        <Button
                          onClick={handleViewResults}
                          variant="outline"
                          className="flex-1"
                          size="lg"
                          data-testid="button-view-results-modal"
                        >
                          View Results
                        </Button>
                        <Button
                          onClick={handleVisitProfile}
                          variant="outline"
                          className="flex-1"
                          size="lg"
                          data-testid="link-visit-profile"
                        >
                          Visit Profile
                        </Button>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
