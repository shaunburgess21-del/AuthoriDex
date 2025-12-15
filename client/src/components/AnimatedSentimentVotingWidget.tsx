import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";
import { useLocation } from "wouter";
import { ArrowLeft, Users } from "lucide-react";

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
  { bg: '#FF1744', glow: '#FF1744' },
  { bg: '#FF6D00', glow: '#FF6D00' },
  { bg: '#FF9100', glow: '#FF9100' },
  { bg: '#FFC400', glow: '#FFC400' },
  { bg: '#FFEA00', glow: '#FFEA00' },
  { bg: '#C6FF00', glow: '#C6FF00' },
  { bg: '#76FF03', glow: '#76FF03' },
  { bg: '#00E676', glow: '#00E676' },
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
  if (value <= 2) return ZONE_LABELS[0];
  if (value <= 4) return ZONE_LABELS[1];
  if (value <= 6) return ZONE_LABELS[2];
  if (value <= 8) return ZONE_LABELS[3];
  return ZONE_LABELS[4];
};

const getApprovalMessage = (value: number, personName: string) => {
  if (value <= 2) return `You strongly disapprove of ${personName}!`;
  if (value <= 4) return `You disapprove of ${personName}.`;
  if (value <= 6) return `You have a neutral opinion about ${personName}.`;
  if (value <= 8) return `You approve of ${personName}.`;
  return `You strongly approve of ${personName}!`;
};

const generateMockCommunityStats = (personId: string) => {
  const seed = personId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const random = (min: number, max: number) => {
    const x = Math.sin(seed * 9999) * 10000;
    return Math.floor((x - Math.floor(x)) * (max - min + 1)) + min;
  };
  
  const totalVotes = random(1500, 8500);
  const distribution = {
    'Hate': random(5, 15),
    'Dislike': random(8, 18),
    'Neutral': random(15, 25),
    'Like': random(25, 35),
    'Love': random(20, 30),
  };
  
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const normalized = Object.fromEntries(
    Object.entries(distribution).map(([k, v]) => [k, Math.round((v / total) * 100)])
  );
  
  const averageRating = (
    (normalized['Hate'] * 1.5 + 
     normalized['Dislike'] * 3.5 + 
     normalized['Neutral'] * 5.5 + 
     normalized['Like'] * 7.5 + 
     normalized['Love'] * 9.5) / 100
  ).toFixed(1);
  
  return {
    totalVotes,
    distribution: normalized as Record<string, number>,
    averageRating: parseFloat(averageRating),
  };
};

interface CommunityResultsViewProps {
  personName: string;
  personId: string;
  userVote: number;
  onBackToVoting: () => void;
}

function CommunityResultsView({ personName, personId, userVote, onBackToVoting }: CommunityResultsViewProps) {
  const stats = useMemo(() => generateMockCommunityStats(personId), [personId]);
  const maxPercent = Math.max(...Object.values(stats.distribution));
  
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
            {stats.totalVotes.toLocaleString()}
          </p>
        </div>
        <div className="bg-muted/50 rounded-xl p-4 text-center">
          <div className="text-sm text-muted-foreground mb-1">Average Rating</div>
          <p 
            className="text-2xl font-bold"
            style={{ color: SEGMENT_COLORS[Math.round(stats.averageRating) - 1]?.bg || '#888' }}
            data-testid="text-average-rating"
          >
            {stats.averageRating}/10
          </p>
          <p className="text-xs text-muted-foreground">
            {getZoneLabel(stats.averageRating)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Sentiment Distribution
        </h4>
        {ZONE_LABELS.map((zone) => {
          const percent = stats.distribution[zone] || 0;
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
            {userVote}/10 - {getZoneLabel(userVote)}
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

  const displayValue = currentValue || 5;
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
            <div className="text-center mb-6">
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

            <div className="space-y-6">
              <div className="relative mb-3 h-16 flex items-center pointer-events-none">
                {ZONE_LABELS.map((label, index) => {
                  const isActive = activeZone === label;
                  const centerSegment = 1.5 + (index * 2);
                  const labelPosition = (centerSegment - 1) / 9;
                  
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
                        px-4 py-2 rounded-xl border transition-all duration-300
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
                <div className="flex justify-between gap-1 absolute inset-x-2 -top-16 -bottom-20 pointer-events-none">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => {
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
                
                <div className="flex justify-between gap-1">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => {
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
                        aria-label={`Select ${value} out of 10`}
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
                          className="w-full h-3.5 rounded-full cursor-pointer"
                          style={{
                            backgroundColor: color.bg,
                            opacity: isFilled ? 1 : 0.4,
                            boxShadow: isFilled 
                              ? `0 0 8px ${color.glow}60, 0 2px 4px rgba(0,0,0,0.3)`
                              : 'none',
                          }}
                          animate={{
                            scale: isActive ? 1.05 : 1,
                          }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        />
                      </div>
                    );
                  })}
                </div>

                {currentValue && (
                  <motion.div
                    className="absolute pointer-events-none"
                    data-testid="vote-needle"
                    style={{
                      top: '-18px',
                    }}
                    initial={{ opacity: 0, scale: 0, left: `calc(0.5rem + (100% - 1rem) * ${(displayValue - 0.5) / 10})` }}
                    animate={{ 
                      opacity: 1, 
                      scale: 1,
                      left: `calc(0.5rem + (100% - 1rem) * ${(displayValue - 0.5) / 10})`,
                      x: '-50%'
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  >
                    <div className="flex flex-col items-center">
                      <motion.div
                        className="w-1 rounded-full"
                        data-testid="needle-line"
                        style={{
                          height: '55px',
                          backgroundColor: SEGMENT_COLORS[displayValue - 1].bg,
                          boxShadow: `0 0 12px ${SEGMENT_COLORS[displayValue - 1].glow}60`,
                        }}
                        animate={{
                          scaleY: isDragging ? 1.1 : 1,
                        }}
                      />
                      <motion.div
                        className="w-6 h-6 rounded-full"
                        data-testid="needle-circle"
                        style={{
                          backgroundColor: SEGMENT_COLORS[displayValue - 1].bg,
                          borderWidth: '3px',
                          borderStyle: 'solid',
                          borderColor: '#ffffff',
                          boxShadow: `0 0 16px ${SEGMENT_COLORS[displayValue - 1].glow}70, 0 4px 8px rgba(0,0,0,0.3)`,
                        }}
                        animate={{
                          scale: isDragging ? 1.15 : 1,
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="flex justify-between gap-1 px-2 mt-[25px] mb-[25px]">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <div
                    key={num}
                    className={`flex-1 text-center text-muted-foreground mt-[7px] mb-[7px] ${
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
                    className="pt-4"
                  >
                    <Button
                      onClick={handleVoteSubmit}
                      disabled={!hasInteracted}
                      className="w-full"
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
                    className="text-center space-y-4 pt-4"
                  >
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-foreground">
                        Your Vote: {displayValue}/10 - {activeZone}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {getApprovalMessage(displayValue, personName)}
                      </p>
                    </div>

                    {isProfilePage ? (
                      <Button
                        onClick={handleViewResults}
                        variant="outline"
                        className="w-full"
                        size="lg"
                        data-testid="button-view-results"
                      >
                        View Results
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <Button
                          onClick={onVoteNext}
                          className="w-full"
                          size="lg"
                          data-testid="button-vote-next"
                        >
                          Vote Next
                        </Button>
                        <button
                          onClick={handleVisitProfile}
                          className="w-full text-center text-sm text-primary hover:underline py-2"
                          data-testid="link-visit-profile"
                        >
                          Visit Profile
                        </button>
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
