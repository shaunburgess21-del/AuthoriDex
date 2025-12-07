import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabase } from "@/lib/supabase";

interface AnimatedSentimentVotingWidgetProps {
  personId: string;
  personName: string;
}

type ViewMode = 'vote' | 'results';

const ZONE_LABELS = ['Hate', 'Dislike', 'Neutral', 'Like', 'Love'];

// Exact colors from Figma design - vivid gradient palette
const SEGMENT_COLORS = [
  { bg: '#FF0000', glow: '#FF0000' }, // 1 - Pure vivid red
  { bg: '#FF1744', glow: '#FF1744' }, // 2 - Bright crimson
  { bg: '#FF6D00', glow: '#FF6D00' }, // 3 - Vivid orange
  { bg: '#FF9100', glow: '#FF9100' }, // 4 - Bright orange
  { bg: '#FFC400', glow: '#FFC400' }, // 5 - Golden amber
  { bg: '#FFEA00', glow: '#FFEA00' }, // 6 - Brilliant yellow
  { bg: '#C6FF00', glow: '#C6FF00' }, // 7 - Electric lime
  { bg: '#76FF03', glow: '#76FF03' }, // 8 - Neon green
  { bg: '#00E676', glow: '#00E676' }, // 9 - Vibrant emerald
  { bg: '#00C853', glow: '#00C853' }, // 10 - Pure green
];

const getZoneLabel = (value: number) => {
  if (value <= 2) return ZONE_LABELS[0]; // Hate: 1-2
  if (value <= 4) return ZONE_LABELS[1]; // Dislike: 3-4
  if (value <= 6) return ZONE_LABELS[2]; // Neutral: 5-6
  if (value <= 8) return ZONE_LABELS[3]; // Like: 7-8
  return ZONE_LABELS[4]; // Love: 9-10
};

const getApprovalMessage = (value: number, personName: string) => {
  if (value <= 2) return `You strongly disapprove of ${personName}!`;
  if (value <= 4) return `You disapprove of ${personName}.`;
  if (value <= 6) return `You have a neutral opinion about ${personName}.`;
  if (value <= 8) return `You approve of ${personName}.`;
  return `You strongly approve of ${personName}!`;
};

const getCommunityApprovalPhrase = (averageRating: number) => {
  if (averageRating <= 2) return 'strongly disapprove of';
  if (averageRating <= 4) return 'disapprove of';
  if (averageRating <= 6) return 'are neutral about';
  if (averageRating <= 8) return 'approve of';
  return 'strongly approve of';
};

// Generate realistic mock vote distribution based on personId
const generateMockVoteDistribution = (personId: string): number[] => {
  // Use personId as seed for consistent results
  const seed = personId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const random = (index: number) => {
    const x = Math.sin(seed + index * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  // Generate a realistic distribution (bell curve tendency towards positive)
  const distribution = [
    Math.floor(random(1) * 15 + 5),   // 1: 5-20 votes
    Math.floor(random(2) * 20 + 10),  // 2: 10-30 votes
    Math.floor(random(3) * 30 + 15),  // 3: 15-45 votes
    Math.floor(random(4) * 40 + 25),  // 4: 25-65 votes
    Math.floor(random(5) * 50 + 40),  // 5: 40-90 votes
    Math.floor(random(6) * 60 + 50),  // 6: 50-110 votes
    Math.floor(random(7) * 80 + 60),  // 7: 60-140 votes
    Math.floor(random(8) * 90 + 70),  // 8: 70-160 votes
    Math.floor(random(9) * 70 + 50),  // 9: 50-120 votes
    Math.floor(random(10) * 50 + 30), // 10: 30-80 votes
  ];

  return distribution;
};

export function AnimatedSentimentVotingWidget({ personId, personName }: AnimatedSentimentVotingWidgetProps) {
  const { user } = useAuth();
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('vote');
  const { toast } = useToast();

  // Load saved vote from localStorage
  useEffect(() => {
    const savedVote = localStorage.getItem(`sentiment-vote-${personId}`);
    if (savedVote) {
      setCurrentValue(parseInt(savedVote, 10));
    }
  }, [personId]);

  // Generate mock vote distribution and calculate average
  const voteDistribution = useMemo(() => generateMockVoteDistribution(personId), [personId]);
  const totalVotes = useMemo(() => voteDistribution.reduce((sum, count) => sum + count, 0), [voteDistribution]);
  const averageRating = useMemo(() => {
    const weightedSum = voteDistribution.reduce((sum, count, index) => sum + count * (index + 1), 0);
    return totalVotes > 0 ? weightedSum / totalVotes : 0;
  }, [voteDistribution, totalVotes]);
  const maxVotes = useMemo(() => Math.max(...voteDistribution), [voteDistribution]);

  const handleValueChange = async (newValue: number) => {
    setCurrentValue(newValue);
    
    // Save to localStorage (for immediate UI update)
    localStorage.setItem(`sentiment-vote-${personId}`, newValue.toString());
    
    // Dispatch custom event to notify other components
    window.dispatchEvent(new CustomEvent('sentiment-vote-updated', {
      detail: { personId, value: newValue }
    }));
    
    // Save to Supabase if user is logged in
    if (user) {
      try {
        const supabase = await getSupabase();
        const { error } = await supabase
          .from('user_votes')
          .upsert({
            userId: user.id,
            personId,
            personName,
            rating: newValue,
          }, {
            onConflict: 'userId,personId',
          });

        if (error) {
          console.error('Error saving vote to Supabase:', error);
        } else {
          console.log('✅ Vote saved to Supabase');
        }
      } catch (error) {
        console.error('Error connecting to Supabase:', error);
      }
    }
    
    // Log telemetry
    console.log('🗳️ [Telemetry] ui.vote_submitted', { 
      personId, 
      value: newValue,
      zone: getZoneLabel(newValue),
      savedToSupabase: !!user
    });
    
    // Show toast notification
    toast({
      title: "Vote Submitted",
      description: `You rated ${personName} as ${getZoneLabel(newValue)}`,
    });
  };

  const handleSegmentClick = (segmentValue: number) => {
    handleValueChange(segmentValue);
  };

  const displayValue = currentValue || 5;
  const activeZone = getZoneLabel(displayValue);

  return (
    <div 
      className="w-full bg-card border border-border rounded-2xl p-8"
      data-testid="sentiment-voting-widget"
    >
      {/* Title Section with Mode Toggle */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div className="flex-1">
          <h3 
            className="text-2xl font-bold mb-2"
            style={{
              background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.7) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {viewMode === 'vote' ? 'Cast Your Vote' : 'Community Results'}
          </h3>
          <p className="text-muted-foreground">
            {viewMode === 'vote' ? (
              <>How do you feel about <span className="text-foreground font-semibold">{personName}</span>?</>
            ) : (
              <>What other FameDex users think about <span className="text-foreground font-semibold">{personName}</span></>
            )}
          </p>
        </div>
        {/* Mode Toggle Buttons */}
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'vote' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('vote')}
            data-testid="button-mode-vote"
            className="text-xs"
          >
            Cast Your Vote
          </Button>
          <Button
            variant={viewMode === 'results' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode('results')}
            data-testid="button-mode-results"
            className="text-xs"
          >
            View Results
          </Button>
        </div>
      </div>
      {/* Content Area with Smooth Transitions */}
      <AnimatePresence mode="wait">
        {viewMode === 'vote' ? (
          <motion.div
            key="vote-view"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
        {/* Zone Labels with Glow Effect - Non-interactive to allow clicks through */}
        <div className="relative mb-3 h-16 flex items-center pointer-events-none">
          {ZONE_LABELS.map((label, index) => {
            const isActive = activeZone === label;
            // Position at center of each zone: Hate(1.5), Dislike(3.5), Neutral(5.5), Like(7.5), Love(9.5)
            // Convert to percentage: (position - 1) / 9 * 100
            const centerSegment = 1.5 + (index * 2); // 1.5, 3.5, 5.5, 7.5, 9.5
            const labelPosition = (centerSegment - 1) / 9; // 0.055, 0.277, 0.5, 0.722, 0.944
            
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
                {/* Speech bubble tail */}
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

        {/* Segmented Bar Area */}
        <div className="relative px-2">
          {/* Clickable columns container - extended vertically for better clickability */}
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
          
          {/* Visual segment bars */}
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
                  {/* Spacer for alignment with bubbles above */}
                  <div className="h-4" />
                  
                  {/* Segment Bar */}
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

          {/* Line Needle Indicator */}
          {currentValue && (
            <motion.div
              className="absolute pointer-events-none"
              data-testid="vote-needle"
              style={{
                top: '-18px', // Shifted down to position circle below segment bar
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
                {/* Solid Vertical Line extending upward */}
                <motion.div
                  className="w-1 rounded-full"
                  data-testid="needle-line"
                  style={{
                    height: '55px', // Reduced height for better positioning
                    backgroundColor: SEGMENT_COLORS[displayValue - 1].bg,
                    boxShadow: `0 0 12px ${SEGMENT_COLORS[displayValue - 1].glow}60`,
                  }}
                  animate={{
                    scaleY: isDragging ? 1.1 : 1,
                  }}
                />
                {/* Circle with colored center and white border */}
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

        {/* Static Numbers Row (1-10) */}
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

        {/* Feedback Text */}
        {currentValue && (
          <motion.div 
            className="text-center space-y-1 mt-[0px] mb-[0px] pt-[0px] pb-[0px]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-sm font-semibold text-foreground">
              Your Vote: {displayValue}/10 - {activeZone}
            </p>
            <p className="text-sm text-muted-foreground mt-[8px] mb-[8px]">
              {getApprovalMessage(displayValue, personName)}
            </p>
          </motion.div>
        )}
      </motion.div>
    ) : (
      <motion.div
        key="results-view"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {/* Average Rating Display */}
        <div className="text-center">
          <p className="font-bold text-foreground mb-1 text-[20px]">
            Average Rating: <span style={{ color: SEGMENT_COLORS[Math.round(averageRating) - 1]?.bg || '#888' }}>
              {averageRating.toFixed(1)}
            </span>/10
          </p>
          <p className="text-sm text-muted-foreground">
            Based on {totalVotes.toLocaleString()} votes
          </p>
        </div>

        {/* Results Bar Chart */}
        <div className="px-2">
          <div className="flex items-end justify-between gap-1 h-48">
            {voteDistribution.map((count, index) => {
              const value = index + 1;
              const color = SEGMENT_COLORS[index];
              const heightPercent = maxVotes > 0 ? (count / maxVotes) * 100 : 0;
              const hasVotes = count > 0;
              
              return (
                <div key={value} className="flex-1 flex flex-col items-center justify-end">
                  <motion.div
                    className="w-full rounded-t-md relative group"
                    style={{
                      height: `${Math.max(heightPercent, hasVotes ? 5 : 0)}%`,
                      backgroundColor: color.bg,
                      opacity: hasVotes ? 1 : 0.4,
                      boxShadow: hasVotes 
                        ? `0 0 8px ${color.glow}60, 0 2px 4px rgba(0,0,0,0.3)`
                        : 'none',
                      minHeight: hasVotes ? '8px' : '0px',
                    }}
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(heightPercent, hasVotes ? 5 : 0)}%` }}
                    transition={{ duration: 0.6, delay: index * 0.05 }}
                    data-testid={`result-bar-${value}`}
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                      <div className="bg-background border border-border rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                        <p className="text-xs font-semibold">{count} votes</p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Number Labels */}
        <div className="flex justify-between gap-1 px-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
            <div
              key={num}
              className="flex-1 text-center text-muted-foreground text-sm font-medium"
              data-testid={`result-number-${num}`}
            >
              {num}
            </div>
          ))}
        </div>

        {/* Community Sentiment Message */}
        <div className="text-center pt-4">
          <p className="text-base text-muted-foreground">
            Other FameDex users <span className="text-foreground font-semibold">
              {getCommunityApprovalPhrase(averageRating)}
            </span> {personName}.
          </p>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
    </div>
  );
}
