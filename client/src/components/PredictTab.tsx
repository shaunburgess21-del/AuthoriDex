import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BattleCard, HeadToHeadBattle } from "@/components/BattleCard";

interface PredictTabProps {
  personId: string;
  personName: string;
  currentScore: number;
}

// All available prediction markets
const allBattles: HeadToHeadBattle[] = [
  {
    id: "battle-1",
    title: "Elon Musk vs Mark Zuckerberg",
    person1: { name: "Elon Musk", avatar: "" },
    person2: { name: "Mark Zuckerberg", avatar: "" },
    category: "Tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "battle-2",
    title: "Taylor Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "" },
    person2: { name: "Beyoncé", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "battle-3",
    title: "Drake vs Kendrick Lamar",
    person1: { name: "Drake", avatar: "" },
    person2: { name: "Kendrick Lamar", avatar: "" },
    category: "Music",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "battle-4",
    title: "Cristiano Ronaldo vs Lionel Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "" },
    person2: { name: "Lionel Messi", avatar: "" },
    category: "Sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 32100,
    person1Percent: 51,
  },
  {
    id: "battle-5",
    title: "Donald Trump vs Joe Biden",
    person1: { name: "Donald Trump", avatar: "" },
    person2: { name: "Joe Biden", avatar: "" },
    category: "Politics",
    endTime: "Sun 23:59 UTC",
    totalPool: 45000,
    person1Percent: 58,
  },
];

export function PredictTab({ personId, personName, currentScore }: PredictTabProps) {
  // Filter battles where the current person is involved
  const personBattles = allBattles.filter(
    (battle) =>
      battle.person1.name === personName || 
      battle.person2.name === personName
  );

  return (
    <div className="space-y-6">
      {/* Test Mode Badge */}
      <Card className="p-4 bg-primary/5 border-primary/20">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
            TEST MODE
          </Badge>
          <span className="text-sm text-muted-foreground">
            Predictions use virtual credits only. No real money involved.
          </span>
        </div>
      </Card>

      {/* Predictions List */}
      {personBattles.length > 0 ? (
        <div className="space-y-4">
          <div className="mb-6">
            <h3 className="text-lg font-serif font-bold mb-2">
              Active Markets for {personName}
            </h3>
            <p className="text-sm text-muted-foreground">
              {personBattles.length} prediction{personBattles.length !== 1 ? "s" : ""} available
            </p>
          </div>
          {personBattles.map((battle) => (
            <BattleCard key={battle.id} battle={battle} compact={true} />
          ))}
        </div>
      ) : (
        <Card className="p-8 text-center border-dashed">
          <div className="space-y-3">
            <p className="text-lg font-semibold">No active markets</p>
            <p className="text-muted-foreground">
              There are currently no prediction markets for {personName}.
            </p>
            <p className="text-sm text-muted-foreground mt-4">
              Check back later or visit the main Prediction Markets page to explore all available markets.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
