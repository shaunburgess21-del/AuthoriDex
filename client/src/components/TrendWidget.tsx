import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { TrendBadge } from "./TrendBadge";
import { LiquidCard } from "./LiquidCard";
import { cn } from "@/lib/utils";

interface TrendWidgetProps {
  title: string;
  people: TrendingPerson[];
  type: "gainer" | "dropper" | "daily";
  onPersonClick?: (personId: string) => void;
}

const colorConfig = {
  daily: {
    gradientColors: ["#3b82f6", "#6366f1", "#3b82f6"] as [string, string, string],
    glowColor: "rgba(59, 130, 246, 0.5)",
  },
  gainer: {
    gradientColors: ["#10b981", "#14b8a6", "#10b981"] as [string, string, string],
    glowColor: "rgba(16, 185, 129, 0.5)",
  },
  dropper: {
    gradientColors: ["#ef4444", "#f97316", "#ef4444"] as [string, string, string],
    glowColor: "rgba(239, 68, 68, 0.5)",
  },
};

export function TrendWidget({ title, people, type, onPersonClick }: TrendWidgetProps) {
  const colors = colorConfig[type];
  
  return (
    <LiquidCard 
      gradientColors={colors.gradientColors} 
      glowColor={colors.glowColor} 
      data-testid={`widget-${type}`}
    >
      <Card className="overflow-hidden bg-transparent border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {people.slice(0, 5).map((person, idx) => (
            <div
              key={person.id}
              className="flex items-center gap-3 p-2 rounded-lg hover-elevate cursor-pointer bg-muted/50"
              onClick={() => onPersonClick?.(person.id)}
              data-testid={`widget-item-${person.id}`}
            >
              <span className="font-mono font-bold text-muted-foreground w-6">
                {idx + 1}
              </span>
              <PersonAvatar name={person.name} avatar={person.avatar} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{person.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {person.category}
                </p>
              </div>
              <TrendBadge 
                value={type === "daily" ? person.change24h : person.change7d} 
                size="sm" 
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </LiquidCard>
  );
}
