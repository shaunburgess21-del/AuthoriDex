import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonAvatar } from "@/components/PersonAvatar";
import { NeonCategoryBadge } from "@/components/NeonCategoryBadge";
import { Clock } from "lucide-react";

export interface HeadToHeadBattle {
  id: string;
  title: string;
  person1: { name: string; avatar: string };
  person2: { name: string; avatar: string };
  category: string;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

interface BattleCardProps {
  battle: HeadToHeadBattle;
  compact?: boolean;
}

export function BattleCard({ battle, compact = false }: BattleCardProps) {
  return (
    <div className={compact ? "" : "px-2"}>
      <Card 
        className="p-4 hover:translate-y-[-2px] hover:shadow-lg hover:border-purple-500/40 hover:shadow-purple-500/20 transition-all duration-200 relative z-0 hover:z-10"
        data-testid={`card-battle-${battle.id}`}
      >
        <div className="flex items-center justify-between mb-3">
          <NeonCategoryBadge category={battle.category} variant="primary" />
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {battle.endTime}
          </span>
        </div>
        
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="text-center">
            <PersonAvatar name={battle.person1.name} avatar={battle.person1.avatar} size="md" />
            <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{battle.person1.name}</p>
            <p className="text-xs text-green-500 font-mono">{battle.person1Percent}%</p>
          </div>
          
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-sm font-bold text-primary">VS</span>
          </div>
          
          <div className="text-center">
            <PersonAvatar name={battle.person2.name} avatar={battle.person2.avatar} size="md" />
            <p className="text-sm font-medium mt-1 truncate max-w-[80px]">{battle.person2.name}</p>
            <p className="text-xs text-red-500 font-mono">{100 - battle.person1Percent}%</p>
          </div>
        </div>
        
        <div className="h-2 w-full bg-muted/30 rounded-full mb-3 overflow-hidden flex">
          <div 
            className="h-full bg-green-500"
            style={{ width: `${battle.person1Percent}%` }}
          />
          <div 
            className="h-full bg-red-500"
            style={{ width: `${100 - battle.person1Percent}%` }}
          />
        </div>
        
        <div className="text-center mb-3">
          <span className="text-sm font-semibold text-primary">
            Pool: {battle.totalPool.toLocaleString()} credits
          </span>
        </div>
        
        <div className="flex gap-2">
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 border-green-500/30 text-green-500"
            data-testid={`button-pick-${battle.id}-person1`}
          >
            {battle.person1.name.split(" ")[0]}
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="flex-1 border-red-500/30 text-red-500"
            data-testid={`button-pick-${battle.id}-person2`}
          >
            {battle.person2.name.split(" ")[0]}
          </Button>
        </div>
      </Card>
    </div>
  );
}
