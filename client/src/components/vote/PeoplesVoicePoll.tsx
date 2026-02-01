import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CategoryPill } from "@/components/CategoryPill";
import { Users, ThumbsUp, ThumbsDown, Minus, MessageSquare } from "lucide-react";

export interface DiscourseTopicData {
  id: string;
  headline: string;
  description: string;
  category: string;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
}

export const DISCOURSE_TOPICS: DiscourseTopicData[] = [
  { id: "d1", headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", category: "Tech", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432 },
  { id: "d2", headline: "AI replacing jobs", description: "Should we embrace or regulate AI in the workplace?", category: "Tech", approvePercent: 28, neutralPercent: 32, disapprovePercent: 40, totalVotes: 156789 },
  { id: "d3", headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Entertainment", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567 },
  { id: "d4", headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Entertainment", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
  { id: "d5", headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765 },
];

export interface PeoplesVoicePollProps {
  topic?: DiscourseTopicData;
  onVote?: (topicId: string, choice: 'support' | 'neutral' | 'oppose') => void;
  onExplore?: () => void;
}

export function PeoplesVoicePoll({ 
  topic = DISCOURSE_TOPICS[0],
  onVote = () => {},
  onExplore,
}: PeoplesVoicePollProps) {
  const [voted, setVoted] = useState<'support' | 'neutral' | 'oppose' | null>(null);

  const handleVote = (choice: 'support' | 'neutral' | 'oppose') => {
    if (!voted) {
      setVoted(choice);
      onVote(topic.id, choice);
    }
  };

  const handleChangeVote = () => {
    setVoted(null);
  };

  return (
    <Card 
      className="p-4 bg-slate-900/60 border border-slate-700/40 backdrop-blur-sm h-full flex flex-col"
      data-testid="peoples-voice-poll"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <MessageSquare className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Trending Polls</h3>
            <p className="text-xs text-muted-foreground">Hot topic</p>
          </div>
        </div>
        <CategoryPill category={topic.category} />
      </div>
      
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
        <Users className="h-3.5 w-3.5 text-violet-400" />
        <span>{topic.totalVotes.toLocaleString()} votes</span>
      </div>
      
      <h4 className="font-serif font-bold text-base mb-1">{topic.headline}</h4>
      <p className="text-sm text-muted-foreground mb-4 flex-grow">{topic.description}</p>
      
      {!voted ? (
        <div className="flex flex-col gap-2">
          <button
            onClick={() => handleVote('support')}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#00C853]/10 border border-[#00C853]/50 text-[#00C853] text-sm font-medium transition-all hover:border-[#00C853]/80 hover:bg-[#00C853]/20"
            data-testid="button-support"
          >
            <div className="flex items-center gap-2">
              <ThumbsUp className="h-4 w-4" />
              <span>Support</span>
            </div>
            <span className="font-mono">{topic.approvePercent}%</span>
          </button>
          <button
            onClick={() => handleVote('neutral')}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-white/5 border border-white/40 text-white text-sm font-medium transition-all hover:border-white/80 hover:bg-white/15"
            data-testid="button-neutral"
          >
            <div className="flex items-center gap-2">
              <Minus className="h-4 w-4" />
              <span>Neutral</span>
            </div>
            <span className="font-mono">{topic.neutralPercent}%</span>
          </button>
          <button
            onClick={() => handleVote('oppose')}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#FF0000]/10 border border-[#FF0000]/50 text-[#FF0000] text-sm font-medium transition-all hover:border-[#FF0000]/80 hover:bg-[#FF0000]/20"
            data-testid="button-oppose"
          >
            <div className="flex items-center gap-2">
              <ThumbsDown className="h-4 w-4" />
              <span>Oppose</span>
            </div>
            <span className="font-mono">{topic.disapprovePercent}%</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Your vote</span>
              <span className={`text-xs font-medium ${
                voted === 'support' ? 'text-[#00C853]' : 
                voted === 'oppose' ? 'text-[#FF0000]' : 
                'text-white'
              }`}>
                {voted.charAt(0).toUpperCase() + voted.slice(1)}
              </span>
            </div>
            <div className="flex gap-1 h-2 rounded-full overflow-hidden">
              <div className="bg-[#00C853]" style={{ width: `${topic.approvePercent}%` }} />
              <div className="bg-gray-400" style={{ width: `${topic.neutralPercent}%` }} />
              <div className="bg-[#FF0000]" style={{ width: `${topic.disapprovePercent}%` }} />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
              <span>{topic.approvePercent}% Support</span>
              <span>{topic.neutralPercent}% Neutral</span>
              <span>{topic.disapprovePercent}% Oppose</span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full text-muted-foreground"
            onClick={handleChangeVote}
          >
            Change Vote
          </Button>
        </div>
      )}
      
      {onExplore && (
        <Button 
          variant="outline" 
          className="w-full mt-3 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          onClick={onExplore}
          data-testid="button-explore-polls"
        >
          View All Polls
        </Button>
      )}
    </Card>
  );
}
