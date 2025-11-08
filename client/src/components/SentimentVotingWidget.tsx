import { useState, useEffect, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';

interface SentimentVotingWidgetProps {
  personId: string;
  personName: string;
  distribution?: Record<string, number>;
  onVoteSubmitted?: (value: number) => void;
}

// Simplified 5-zone labels matching Figma
const ZONE_LABELS = ['Hate', 'Dislike', 'Neutral', 'Like', 'Love'];

// Speech Bubble Component (to use hooks properly)
function SpeechBubble({ label, isActive }: { label: string; isActive: boolean }) {
  return (
    <div className="relative">
      {/* Speech Bubble */}
      <div 
        className={`
          px-4 py-2 rounded-xl transition-all duration-300 relative border
          ${isActive 
            ? 'bg-card text-foreground border-border shadow-lg scale-110' 
            : 'bg-transparent text-muted-foreground border-border/50'
          }
        `}
        style={isActive ? {
          boxShadow: '0 0 20px rgba(255, 255, 255, 0.15), 0 0 40px rgba(255, 255, 255, 0.1)'
        } : {}}
      >
        {label}
      </div>
      {/* Speech Bubble Tail - using bg-card class to match bubble */}
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
    </div>
  );
}

// Detailed labels for each value 1-10
const SENTIMENT_LABELS = [
  'Hate',
  'Strong Dislike',
  'Dislike',
  'Somewhat Dislike',
  'Neutral',
  'Somewhat Like',
  'Like',
  'Strong Like',
  'Love',
  'Absolutely Love',
];

export function SentimentVotingWidget({ 
  personId, 
  personName, 
  distribution = {},
  onVoteSubmitted 
}: SentimentVotingWidgetProps) {
  const [selectedValue, setSelectedValue] = useState<number | null>(null);
  const [tempValue, setTempValue] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Check if user has already voted (stored in localStorage for now)
  useEffect(() => {
    const storedVote = localStorage.getItem(`vote_${personId}`);
    if (storedVote) {
      setSelectedValue(parseInt(storedVote));
    }
  }, [personId]);

  // Convert value (1-10) to position percentage (0-100)
  const valueToPosition = (value: number) => {
    return ((value - 1) / 9) * 100;
  };

  // Convert position percentage to value (1-10)
  const positionToValue = (percentage: number) => {
    return Math.round((percentage / 100) * 9) + 1;
  };

  const calculateValueFromEvent = (e: PointerEvent | React.PointerEvent<HTMLDivElement>) => {
    if (!sliderRef.current) return null;
    
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    return Math.max(1, Math.min(10, positionToValue(percentage)));
  };

  const handleVote = async (value: number) => {
    try {
      // Store locally and call callback
      localStorage.setItem(`vote_${personId}`, value.toString());
      setSelectedValue(value);
      setTempValue(null);
      
      // Log telemetry event
      console.log('[Telemetry] ui.vote_submitted', { personId, value });
      
      // Show feedback message
      setShowFeedback(true);
      setTimeout(() => setShowFeedback(false), 3000);
      
      toast({
        title: 'Vote Submitted',
        description: `You rated ${personName} as ${SENTIMENT_LABELS[value - 1]}`,
      });
      
      onVoteSubmitted?.(value);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to submit vote. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const value = calculateValueFromEvent(e);
    if (value !== null) {
      setIsDragging(true);
      setTempValue(value);
      // Capture pointer to ensure we get pointerup even if mouse leaves window
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    
    const value = calculateValueFromEvent(e);
    if (value !== null) {
      setTempValue(value);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging && tempValue !== null) {
      setIsDragging(false);
      handleVote(tempValue);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleClick = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only handle direct clicks (not drag releases)
    if (!isDragging) {
      const value = calculateValueFromEvent(e);
      if (value !== null) {
        handleVote(value);
      }
    }
  };

  // Keyboard accessibility
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentValue = tempValue || selectedValue || 5;
    let newValue = currentValue;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        newValue = Math.max(1, currentValue - 1);
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        newValue = Math.min(10, currentValue + 1);
        e.preventDefault();
        break;
      case 'Home':
        newValue = 1;
        e.preventDefault();
        break;
      case 'End':
        newValue = 10;
        e.preventDefault();
        break;
      case 'Enter':
      case ' ':
        if (tempValue !== null && tempValue !== selectedValue) {
          handleVote(tempValue);
        }
        e.preventDefault();
        return;
    }

    if (newValue !== currentValue) {
      setTempValue(newValue);
    }
  };

  // Get the zone label for a value (1-2 = Hate, 3-4 = Dislike, 5-6 = Neutral, 7-8 = Like, 9-10 = Love)
  const getZoneLabel = (value: number) => {
    if (value <= 2) return ZONE_LABELS[0]; // Hate
    if (value <= 4) return ZONE_LABELS[1]; // Dislike
    if (value <= 6) return ZONE_LABELS[2]; // Neutral
    if (value <= 8) return ZONE_LABELS[3]; // Like
    return ZONE_LABELS[4]; // Love
  };

  const displayValue = tempValue || selectedValue;

  return (
    <Card className="p-8" data-testid="sentiment-voting-widget">
      {/* Title and Subtitle */}
      <div className="text-center mb-6">
        <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
          Cast Your Vote
        </h2>
        <p className="text-base text-muted-foreground">
          How do you feel about <span className="font-semibold text-foreground">{personName}</span>?
        </p>
      </div>

      {/* Interactive Slider */}
      <div className="space-y-6">
        {/* Zone Labels Above Slider - Speech Bubble Style */}
        <div className="flex justify-between px-2 text-sm font-semibold mb-8">
          {ZONE_LABELS.map((label, i) => {
            const isActive = !!(displayValue && getZoneLabel(displayValue) === label);
            return (
              <SpeechBubble key={i} label={label} isActive={isActive} />
            );
          })}
        </div>

        {/* Gradient Slider with Draggable Needle */}
        <div className="relative">
          <div
            ref={sliderRef}
            role="slider"
            aria-label="Sentiment rating from 1 to 10"
            aria-valuemin={1}
            aria-valuemax={10}
            aria-valuenow={displayValue || undefined}
            aria-valuetext={displayValue ? `${displayValue}/10 - ${getZoneLabel(displayValue)}` : undefined}
            tabIndex={0}
            className="h-14 rounded-full cursor-pointer relative overflow-visible focus:outline-none"
            style={{
              background: 'linear-gradient(to right, #dc2626 0%, #f97316 25%, #fbbf24 50%, #84cc16 75%, #22c55e 100%)',
            }}
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={handleKeyDown}
            data-testid="sentiment-slider"
          >
            {/* Draggable Glowing Needle - Simple hollow circle with center dot */}
            {displayValue !== null && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-12 h-12 rounded-full cursor-grab active:cursor-grabbing hover:scale-110 pointer-events-none transition-transform duration-200"
                style={{
                  left: `${valueToPosition(displayValue)}%`,
                  background: 'transparent',
                  border: '3px solid rgba(255, 255, 255, 0.9)',
                  boxShadow: '0 0 15px rgba(255, 255, 255, 0.4), 0 0 30px rgba(255, 255, 255, 0.2)',
                }}
                data-testid="sentiment-needle"
                aria-hidden="true"
              >
                {/* Center dot */}
                <div 
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                  style={{
                    background: 'rgba(255, 255, 255, 0.9)',
                    boxShadow: '0 0 8px rgba(255, 255, 255, 0.5)',
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Numbers 1-10 Below Slider */}
        <div className="flex justify-between px-1 text-xs text-muted-foreground font-mono">
          {Array.from({ length: 10 }, (_, i) => (
            <div 
              key={i + 1} 
              className={`w-8 text-center ${
                displayValue === i + 1 
                  ? 'text-foreground font-bold scale-125 transition-transform' 
                  : ''
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Current Rating Display */}
        {displayValue !== null && (
          <div className="text-center pt-4 border-t">
            <p className="text-lg font-semibold">
              Current Rating: {displayValue}/10 - {getZoneLabel(displayValue)}
            </p>
            {showFeedback && (
              <p className="text-sm text-muted-foreground mt-2 animate-in fade-in">
                Thanks for your feedback. We'll try to do better.
              </p>
            )}
          </div>
        )}

        {/* Initial Prompt */}
        {displayValue === null && (
          <div className="text-center pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Click, drag, or use arrow keys to rate your experience
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
