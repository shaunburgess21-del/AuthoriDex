import { useState } from "react";
import { TrendingPerson } from "@shared/schema";
import { PersonAvatar } from "./PersonAvatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, Crown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface TrendingBarChartProps {
  people: TrendingPerson[];
}

export function TrendingBarChart({ people }: TrendingBarChartProps) {
  const [displayCount, setDisplayCount] = useState<10 | 30>(10);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const topPeople = people.slice(0, displayCount).reverse(); // Reverse so #10...#1 left to right
  
  if (topPeople.length === 0) return null;

  // Calculate max score for scaling
  const maxScore = Math.max(...topPeople.map(p => p.trendScore));
  const minScore = Math.min(...topPeople.map(p => p.trendScore));
  const scoreRange = maxScore - minScore || 1; // Prevent division by zero

  // Leader info for AI insight
  const leader = people[0];
  const runnerUp = people[1];
  const scoreDiff = leader && runnerUp ? (leader.trendScore - runnerUp.trendScore).toFixed(0) : '0';

  // Generate gradient color based on position
  const getBarColor = (index: number, total: number) => {
    const position = index / (total - 1); // 0 to 1
    
    let r: number, g: number, b: number;
    
    // Blue (#3b82f6) to Electric Blue (#0ea5e9) to Bright Green (#00C853)
    if (position < 0.5) {
      // Light blue to electric blue
      const t = position * 2; // 0 to 1
      r = Math.round(59 + (14 - 59) * t);
      g = Math.round(130 + (165 - 130) * t);
      b = Math.round(246 + (233 - 246) * t);
    } else {
      // Electric blue to bright green
      const t = (position - 0.5) * 2; // 0 to 1
      r = Math.round(14 + (0 - 14) * t);
      g = Math.round(165 + (200 - 165) * t);
      b = Math.round(233 + (83 - 233) * t);
    }
    
    return {
      solid: `rgb(${r}, ${g}, ${b})`,
      glow: `rgba(${r}, ${g}, ${b}, 0.4)`,
    };
  };

  return (
    <Card className="overflow-hidden bg-[#0f1419] border-[#1f2937]" data-testid="trending-bar-chart">
      {/* Header */}
      <div className="p-6 border-b border-[#1f2937]">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-serif font-bold">Most Influential People Worldwide</h2>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
              <motion.div
                className="h-2 w-2 rounded-full bg-blue-500"
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <span className="text-xs font-medium text-blue-400">Live Updating</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={displayCount === 10 ? "default" : "outline"}
              size="sm"
              onClick={() => setDisplayCount(10)}
              data-testid="button-top-10"
            >
              Top 10
            </Button>
            <Button
              variant={displayCount === 30 ? "default" : "outline"}
              size="sm"
              onClick={() => setDisplayCount(30)}
              data-testid="button-top-30"
            >
              Top 30
            </Button>
          </div>
        </div>
      </div>
      {/* Bar Chart */}
      <div className="p-6 overflow-x-auto">
        <div className="flex items-end justify-center gap-2 min-h-[400px]" style={{ minWidth: displayCount === 30 ? '1200px' : '600px' }}>
          <AnimatePresence mode="popLayout">
            {topPeople.map((person, index) => {
              const barHeight = ((person.trendScore - minScore) / scoreRange) * 300 + 100;
              const isTop3 = index >= topPeople.length - 3;
              const isLeader = index === topPeople.length - 1;
              const colors = getBarColor(index, topPeople.length);
              const actualRank = person.rank;

              return (
                <motion.div
                  key={person.id}
                  className="relative flex flex-col items-center"
                  initial={{ opacity: 0, y: 50 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.5, delay: index * 0.05 }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ flex: 1, maxWidth: displayCount === 30 ? '40px' : '60px' }}
                >
                  {/* Tooltip on hover */}
                  <AnimatePresence>
                    {hoveredIndex === index && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute -top-16 bg-background/95 backdrop-blur-sm border border-border rounded-lg px-3 py-2 shadow-xl z-10 whitespace-nowrap"
                      >
                        <p className="font-semibold text-sm">{person.name}</p>
                        <p className="text-xs text-muted-foreground">Rank #{actualRank}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {/* Avatar with crown for #1 */}
                  <motion.div
                    className="relative mb-2"
                    whileHover={{ scale: 1.1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <PersonAvatar 
                      name={person.name} 
                      avatar={person.avatar} 
                      size={displayCount === 30 ? "sm" : "md"}
                    />
                    {isLeader && (
                      <div className="absolute -top-2 -right-2 bg-yellow-500 rounded-full p-1">
                        <Crown className="h-3 w-3 text-yellow-900" fill="currentColor" />
                      </div>
                    )}
                  </motion.div>
                  {/* Bar with glow effect */}
                  <motion.div
                    className="relative w-full rounded-t-lg overflow-hidden"
                    style={{
                      height: `${barHeight}px`,
                      backgroundColor: colors.solid,
                      boxShadow: isTop3 
                        ? `0 0 ${isLeader ? '30px' : '20px'} ${isLeader ? '8px' : '4px'} ${colors.glow}`
                        : 'none',
                    }}
                    whileHover={{ scaleY: 1.05, scaleX: 1.1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Gradient overlay for depth */}
                    <div 
                      className="absolute inset-0" 
                      style={{
                        background: `linear-gradient(to top, ${colors.solid}00, ${colors.glow})`,
                      }}
                    />
                  </motion.div>
                  {/* Footer with rank */}
                  <div 
                    className="w-full bg-[#0a0e13] border-t border-[#1f2937] rounded-b-lg flex items-center justify-center"
                    style={{ height: '56px' }}
                  >
                    <span className="font-mono font-bold text-muted-foreground text-[16px]">
                      #{actualRank}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
      {/* AI Insight Row */}
      {leader && runnerUp && (
        <div className="px-6 pb-6">
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
            <div className="mt-0.5">
              <TrendingUp className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm">
                <span className="font-semibold text-blue-400">AI Insight:</span>
                {' '}
                <span className="font-semibold">{leader.name}</span> leads global rankings — 
                <span className="font-mono font-bold text-blue-400"> {scoreDiff}</span> points ahead of #{runnerUp.rank} {runnerUp.name}.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
