import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { ArrowLeft, Users, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

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
    distribution: { Hate: 0, Dislike: 0, Neutral: 0, Like: 0, Love: 0 }
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
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [showingResults, setShowingResults] = useState(false);

  const { data: approvalFromServer, isFetched: approvalFetched } = useQuery<{ rating: number | null }>({
    queryKey: ["/api/celebrity", personId, "approval-rating", user?.id ?? ""],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/celebrity/${personId}/approval-rating`, {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch approval rating");
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    setCurrentValue(null);
    setIsSubmitted(false);
    setHasInteracted(false);
    setShowingResults(false);

    if (!user?.id) {
      const savedVote = localStorage.getItem(`sentiment-vote-${personId}`);
      if (savedVote) {
        const n = parseInt(savedVote, 10);
        if (n >= 1 && n <= 5) {
          setCurrentValue(n);
          setIsSubmitted(true);
        }
      }
    }
  }, [personId, user?.id]);

  useEffect(() => {
    if (!user?.id || !approvalFetched) return;
    if (approvalFromServer?.rating != null) {
      const r = approvalFromServer.rating;
      setCurrentValue(r);
      setIsSubmitted(true);
      try {
        localStorage.setItem(`sentiment-vote-${personId}`, String(r));
      } catch {
        /* ignore */
      }
      return;
    }
    const savedVote = localStorage.getItem(`sentiment-vote-${personId}`);
    if (savedVote) {
      const n = parseInt(savedVote, 10);
      if (n >= 1 && n <= 5) {
        setCurrentValue(n);
        setIsSubmitted(true);
      }
    }
  }, [user?.id, personId, approvalFetched, approvalFromServer?.rating]);

  const handleSegmentClick = (segmentValue: number) => {
    setCurrentValue(segmentValue);
    setHasInteracted(true);
  };

  const handleVoteSubmit = async () => {
    if (!currentValue) return;

    try {
      localStorage.setItem("authoridex-has-ever-voted", "1");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("authoridex-ever-voted"));
    window.dispatchEvent(
      new CustomEvent("sentiment-vote-updated", {
        detail: { personId, value: currentValue },
      })
    );

    if (user) {
      try {
        await apiRequest("POST", `/api/celebrity/${personId}/approval-rating`, {
          rating: currentValue,
        });
        try {
          localStorage.setItem(`sentiment-vote-${personId}`, currentValue.toString());
        } catch {
          /* ignore */
        }
        setIsSubmitted(true);
        await queryClient.invalidateQueries({
          queryKey: ["/api/celebrity", personId, "approval-rating"],
        });
        await queryClient.invalidateQueries({ queryKey: [`/api/trending/${personId}`] });
        await queryClient.invalidateQueries({
          queryKey: ["/api/celebrity", personId, "sentiment-stats"],
        });
      } catch (error) {
        console.error("Error saving approval rating:", error);
      }
    } else {
      try {
        localStorage.setItem(`sentiment-vote-${personId}`, currentValue.toString());
      } catch {
        /* ignore */
      }
      setIsSubmitted(true);
    }
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

  const activeZone = currentValue ? getZoneLabel(currentValue) : null;

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
            <div className="text-center mb-5">
              <h3 
                className="text-2xl font-bold mb-1"
                style={{
                  background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                Rate {personName}
              </h3>
              <p className="text-muted-foreground">
                How do you feel about <span className="text-foreground font-semibold">{personName}</span>?
              </p>
            </div>

            <div className="grid grid-cols-5 gap-1.5 sm:gap-2 mb-3">
              {ZONE_LABELS.map((label, index) => {
                const isActive = activeZone === label;
                const color = SEGMENT_COLORS[index];
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleSegmentClick(index + 1)}
                    className={`
                      relative py-1.5 sm:py-2 rounded-lg border text-xs sm:text-sm font-medium
                      transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/50
                      ${isActive 
                        ? 'bg-card text-foreground scale-[1.05]' 
                        : 'bg-transparent text-muted-foreground border-border/40 hover:border-border/70'
                      }
                    `}
                    style={isActive ? {
                      borderColor: `${color.bg}80`,
                      boxShadow: `0 0 4px ${color.bg}15`,
                    } : undefined}
                  >
                    {label}
                    {isActive && (
                      <span
                        className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 rotate-45 bg-card"
                        style={{ borderRight: `1px solid ${color.bg}80`, borderBottom: `1px solid ${color.bg}80` }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {[1, 2, 3, 4, 5].map((value) => {
                const color = SEGMENT_COLORS[value - 1];
                const isActive = currentValue === value;
                const isFilled = currentValue !== null && value <= currentValue;

                return (
                  <div
                    key={value}
                    className="flex flex-col items-center cursor-pointer outline-none"
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
                    <div className="relative w-full h-6 sm:h-5 flex items-center justify-center">
                      <motion.div
                        className="absolute inset-0 rounded-full"
                        style={{
                          backgroundColor: color.bg,
                          opacity: currentValue === null ? 0.55 : (isFilled ? 1 : 0.3),
                          boxShadow: isActive
                            ? `0 0 8px ${color.glow}40`
                            : isFilled
                              ? `0 0 4px ${color.glow}25`
                              : 'none',
                        }}
                        animate={{ scale: isActive ? 1.06 : 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                      />
                      <AnimatePresence>
                        {isActive && (
                          <motion.div
                            className="relative z-10 pointer-events-none"
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0 }}
                            transition={{ type: "spring", stiffness: 300, damping: 22 }}
                            data-testid="vote-thumb"
                          >
                            <div
                              className="w-4 h-4 rounded-full"
                              style={{
                                backgroundColor: color.bg,
                                border: '2.5px solid #ffffff',
                                boxShadow: `0 0 6px ${color.glow}40, 0 2px 4px rgba(0,0,0,0.2)`,
                              }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <span
                      className={`mt-2 text-base transition-all duration-200 ${
                        isActive ? 'font-bold' : 'font-medium text-muted-foreground'
                      }`}
                      style={isActive ? { color: color.bg } : undefined}
                      data-testid={`number-label-${value}`}
                    >
                      {value}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5">
              <AnimatePresence mode="wait">
                {!isSubmitted ? (
                  <motion.div
                    key="submit-button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
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
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="text-center flex flex-col items-center gap-4"
                  >
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-foreground">
                        Your Vote:{' '}
                        <span style={{ color: currentValue ? SEGMENT_COLORS[currentValue - 1]?.bg : undefined }}>
                          {currentValue}/5 - {activeZone}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {currentValue ? getApprovalMessage(currentValue, personName) : ''}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setIsSubmitted(false);
                        setHasInteracted(true);
                      }}
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                      data-testid="button-change-vote"
                    >
                      Change Vote
                    </button>

                    {isProfilePage ? (
                      <Button
                        onClick={handleViewResults}
                        className="w-full bg-gradient-to-r from-blue-600 to-blue-500 border-blue-400/30 text-white shadow-lg shadow-blue-500/20"
                        size="lg"
                        data-testid="button-view-results"
                      >
                        View Results
                      </Button>
                    ) : (
                      <div className="flex flex-col sm:flex-row gap-3 w-full">
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
