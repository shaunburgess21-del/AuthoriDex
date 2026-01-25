import { useQuery } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown, Star, Vote } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";

interface ApprovalLeader {
  personId: string;
  personName: string;
  avgRating: number;
  voteCount: number;
  approvalPercent: number;
  avatar: string | null;
  category: string | null;
}

interface ApprovalLeadersResponse {
  highest: ApprovalLeader | null;
  lowest: ApprovalLeader | null;
  message?: string;
}

interface ApprovalViralHookProps {
  onRateClick: (personId: string) => void;
}

export function ApprovalViralHook({ onRateClick }: ApprovalViralHookProps) {
  const { data, isLoading, error } = useQuery<ApprovalLeadersResponse>({
    queryKey: ['/api/approval-leaders'],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto">
          <div className="h-48 rounded-xl pulse-card-green animate-pulse" />
          <div className="h-48 rounded-xl pulse-card-red animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !data || (!data.highest && !data.lowest)) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-6" data-testid="approval-viral-hook">
      <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto">
        {data.highest && (
          <ApprovalCard
            type="highest"
            person={data.highest}
            onRateClick={onRateClick}
          />
        )}
        {data.lowest && (
          <ApprovalCard
            type="lowest"
            person={data.lowest}
            onRateClick={onRateClick}
          />
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  type,
  person,
  onRateClick,
}: {
  type: "highest" | "lowest";
  person: ApprovalLeader;
  onRateClick: (personId: string) => void;
}) {
  const isHighest = type === "highest";
  const cardClass = isHighest ? "pulse-card-green" : "pulse-card-red";
  const iconBgClass = isHighest ? "pulse-icon-green" : "pulse-icon-red";
  const iconColor = isHighest ? "text-green-400" : "text-red-400";
  const percentColor = isHighest ? "text-green-400" : "text-red-400";
  const Icon = isHighest ? ThumbsUp : ThumbsDown;
  
  // Glassy badge styling - green tint for highest, red tint for lowest
  const badgeClass = isHighest 
    ? "bg-green-500/10 text-green-400 border border-green-500/30 backdrop-blur-sm"
    : "bg-red-500/10 text-red-400 border border-red-500/30 backdrop-blur-sm";
  const badgeTestId = isHighest ? "text-approval-badge-highest" : "text-approval-badge-lowest";

  return (
    <div
      className={`rounded-xl ${cardClass} transition-all duration-200`}
      data-testid={`approval-card-${type}`}
    >
      <div className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${iconBgClass}`}>
            <Icon className={`h-4 w-4 ${iconColor}`} />
          </div>
          <span 
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${badgeClass}`}
            data-testid={badgeTestId}
          >
            {isHighest ? "Highest Approval" : "Lowest Approval"}
          </span>
        </div>
        
        <div className="flex flex-col items-center text-center space-y-3">
          <PersonAvatar 
            name={person.personName} 
            avatar={person.avatar || undefined} 
            size="lg" 
          />
          
          <div className="space-y-1">
            <h3 className="font-semibold text-sm text-slate-100 truncate max-w-full">
              {person.personName}
            </h3>
            {person.category && (
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                {person.category}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            <span className={`text-3xl font-bold tabular-nums ${percentColor}`}>
              {person.approvalPercent}%
            </span>
          </div>
          
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <Star className="h-3 w-3" />
            <span>{person.voteCount.toLocaleString()} votes</span>
          </div>
          
          <Button
            size="sm"
            variant="outline"
            className="w-full mt-2 border-violet-500/50 text-violet-300"
            onClick={() => onRateClick(person.personId)}
            data-testid={`button-rate-${type}`}
          >
            <Vote className="h-3.5 w-3.5 mr-1.5" />
            Rate Now
          </Button>
        </div>
      </div>
    </div>
  );
}
