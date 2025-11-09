import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { useToast } from "@/hooks/use-toast";

interface AnimatedSentimentVotingWidgetProps {
  personId: string;
  personName: string;
}

const ZONE_LABELS = ['Hate', 'Dislike', 'Neutral', 'Like', 'Love'];

// Vibrant color palette for each segment (most beautiful colors ever!)
const SEGMENT_COLORS = [
  { bg: '#dc2626', glow: '#dc2626' }, // 1 - Deep crimson red
  { bg: '#ef4444', glow: '#ef4444' }, // 2 - Bright red
  { bg: '#f97316', glow: '#f97316' }, // 3 - Vibrant orange
  { bg: '#fb923c', glow: '#fb923c' }, // 4 - Bright orange
  { bg: '#fbbf24', glow: '#fbbf24' }, // 5 - Bright yellow/gold
  { bg: '#fde047', glow: '#fde047' }, // 6 - Sunny yellow
  { bg: '#84cc16', glow: '#84cc16' }, // 7 - Lime green
  { bg: '#a3e635', glow: '#a3e635' }, // 8 - Bright lime
  { bg: '#10b981', glow: '#10b981' }, // 9 - Emerald green
  { bg: '#14b8a6', glow: '#14b8a6' }, // 10 - Cyan/turquoise
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

export function AnimatedSentimentVotingWidget({ personId, personName }: AnimatedSentimentVotingWidgetProps) {
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();

  // Load saved vote from localStorage
  useEffect(() => {
    const savedVote = localStorage.getItem(`sentiment-vote-${personId}`);
    if (savedVote) {
      setCurrentValue(parseInt(savedVote, 10));
    }
  }, [personId]);

  const handleValueChange = (newValue: number) => {
    setCurrentValue(newValue);
    
    // Save to localStorage
    localStorage.setItem(`sentiment-vote-${personId}`, newValue.toString());
    
    // Log telemetry
    console.log('🗳️ [Telemetry] ui.vote_submitted', { 
      personId, 
      value: newValue,
      zone: getZoneLabel(newValue)
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
      {/* Title Section */}
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
          Cast Your Vote
        </h3>
        <p className="text-muted-foreground">
          How do you feel about <span className="text-foreground font-semibold">{personName}</span>?
        </p>
      </div>

      {/* Interactive Segmented Slider */}
      <div className="space-y-6">
        {/* Zone Labels with Glow Effect - Non-interactive to allow clicks through */}
        <div className="relative mb-8 h-16 flex justify-between items-center px-2 pointer-events-none">
          {ZONE_LABELS.map((label, index) => {
            const isActive = activeZone === label;
            const labelPosition = index / (ZONE_LABELS.length - 1);
            
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
          {/* Clickable columns container */}
          <div className="flex justify-between gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => {
              const isActive = value === displayValue;
              const isFilled = value <= displayValue;
              const color = SEGMENT_COLORS[value - 1];
              
              return (
                <div
                  key={value}
                  className="flex-1 flex flex-col items-center cursor-pointer group"
                  onClick={() => handleSegmentClick(value)}
                  data-testid={`segment-column-${value}`}
                >
                  {/* Spacer for alignment with bubbles above */}
                  <div className="h-12" />
                  
                  {/* Segment Bar */}
                  <motion.div
                    className="w-full h-3.5 rounded-full"
                    style={{
                      backgroundColor: isFilled ? color.bg : 'rgba(100, 116, 139, 0.2)',
                      boxShadow: isFilled 
                        ? `0 0 8px ${color.glow}60, 0 2px 4px rgba(0,0,0,0.3)`
                        : 'none',
                    }}
                    animate={{
                      scale: isActive ? 1.05 : 1,
                    }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  />
                  
                  {/* Number Label */}
                  <motion.div
                    className="mt-3 text-slate-300 transition-all duration-300"
                    animate={{
                      scale: isActive ? 1.3 : 1,
                      opacity: isActive ? 1 : 0.6,
                      fontWeight: isActive ? 700 : 400,
                    }}
                  >
                    {value}
                  </motion.div>
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
                left: `${((displayValue - 1) / 9) * 100}%`,
                top: '48px', // Align with segments
                transform: 'translateX(-50%)',
              }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <div className="flex flex-col items-center">
                {/* Vertical Line */}
                <motion.div
                  className="w-1 h-16 rounded-full"
                  data-testid="needle-line"
                  style={{
                    background: `linear-gradient(to bottom, ${SEGMENT_COLORS[displayValue - 1].bg}, ${SEGMENT_COLORS[displayValue - 1].bg}dd)`,
                    boxShadow: `0 0 16px ${SEGMENT_COLORS[displayValue - 1].glow}70, 0 0 32px ${SEGMENT_COLORS[displayValue - 1].glow}40`,
                  }}
                  animate={{
                    scaleY: isDragging ? 1.1 : 1,
                  }}
                />
                {/* Hollow Circle at Bottom */}
                <motion.div
                  className="w-6 h-6 rounded-full -mt-3"
                  data-testid="needle-circle"
                  style={{
                    backgroundColor: 'transparent',
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

        {/* Feedback Text */}
        {currentValue && (
          <motion.div 
            className="text-center space-y-1 pt-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-sm font-semibold text-foreground">
              Your Vote: {displayValue}/10 - {activeZone}
            </p>
            <p className="text-sm text-muted-foreground">
              {getApprovalMessage(displayValue, personName)}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
