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

const gradientMap = {
  gainer: "greenCyan" as const,
  dropper: "purplePink" as const,
  daily: "tealYellow" as const,
};

export function TrendWidget({ title, people, type, onPersonClick }: TrendWidgetProps) {
  return (
    <LiquidCard gradient={gradientMap[type]} data-testid={`widget-${type}`}>
      <Card className="overflow-hidden bg-transparent border-0 shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-serif">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {people.slice(0, 5).map((person, idx) => (
            <div
              key={person.id}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg hover-elevate cursor-pointer",
                type === "gainer" && "bg-trend-up/5",
                type === "dropper" && "bg-trend-down/5"
              )}
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
