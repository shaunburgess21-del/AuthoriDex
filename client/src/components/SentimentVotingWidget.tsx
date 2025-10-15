import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SentimentVotingWidgetProps {
  personId: string;
  personName: string;
  distribution?: Record<string, number>;
  onVoteSubmitted?: (value: number) => void;
}

const SENTIMENT_COLORS = [
  '#dc2626', // 1 - Red (Hate)
  '#ea580c', // 2 - Red-Orange
  '#f97316', // 3 - Orange
  '#fb923c', // 4 - Light Orange
  '#fbbf24', // 5 - Yellow (Neutral)
  '#a3e635', // 6 - Yellow-Green
  '#84cc16', // 7 - Light Green
  '#22c55e', // 8 - Green
  '#16a34a', // 9 - Dark Green
  '#15803d', // 10 - Very Dark Green (Love)
];

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
  const [hoveredValue, setHoveredValue] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Calculate percentages from distribution
  const total = Object.values(distribution).reduce((sum, count) => sum + count, 0);
  const percentages = Array.from({ length: 10 }, (_, i) => {
    const value = i + 1;
    const count = distribution[value.toString()] || 0;
    return total > 0 ? (count / total) * 100 : 0;
  });

  // Check if user has already voted (stored in localStorage for now)
  useEffect(() => {
    const storedVote = localStorage.getItem(`vote_${personId}`);
    if (storedVote) {
      setSelectedValue(parseInt(storedVote));
    }
  }, [personId]);

  const handleVote = async (value: number) => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    
    try {
      // For now, just store locally and call callback
      // TODO: Replace with Supabase cast_vote RPC call
      localStorage.setItem(`vote_${personId}`, value.toString());
      setSelectedValue(value);
      
      // Log telemetry event
      console.log('[Telemetry] ui.vote_submitted', { personId, value });
      
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayValue = hoveredValue || selectedValue || null;

  return (
    <Card className="p-4 space-y-3" data-testid="sentiment-voting-widget">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">Community Sentiment</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-xs text-muted-foreground hover:text-foreground">
                ?
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click to rate your sentiment (1-10)</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Voting Scale */}
      <div className="space-y-2">
        <div className="flex gap-1">
          {Array.from({ length: 10 }, (_, i) => {
            const value = i + 1;
            const isSelected = selectedValue === value;
            const isHovered = hoveredValue === value;
            
            return (
              <TooltipProvider key={value}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      data-testid={`sentiment-button-${value}`}
                      onClick={() => handleVote(value)}
                      onMouseEnter={() => setHoveredValue(value)}
                      onMouseLeave={() => setHoveredValue(null)}
                      disabled={isSubmitting}
                      className={`flex-1 h-10 rounded transition-all ${
                        isSelected 
                          ? 'ring-2 ring-white ring-offset-2 ring-offset-background scale-105' 
                          : ''
                      } ${
                        isHovered 
                          ? 'scale-105 opacity-100' 
                          : 'opacity-70 hover:opacity-100'
                      }`}
                      style={{ 
                        backgroundColor: SENTIMENT_COLORS[i],
                      }}
                    >
                      <span className="text-white text-xs font-bold">{value}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{SENTIMENT_LABELS[i]}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        {/* Current Selection Display */}
        {displayValue && (
          <div className="text-center">
            <p className="text-sm font-medium" style={{ color: SENTIMENT_COLORS[displayValue - 1] }}>
              {SENTIMENT_LABELS[displayValue - 1]}
            </p>
          </div>
        )}
      </div>

      {/* Distribution Bar (if we have data) */}
      {total > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Distribution ({total} votes)</p>
          <div className="flex gap-0.5 h-2 rounded-full overflow-hidden bg-muted">
            {percentages.map((percentage, i) => (
              percentage > 0 && (
                <div
                  key={i}
                  data-testid={`distribution-bar-${i + 1}`}
                  className="transition-all"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: SENTIMENT_COLORS[i],
                    opacity: 0.8,
                  }}
                />
              )
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
