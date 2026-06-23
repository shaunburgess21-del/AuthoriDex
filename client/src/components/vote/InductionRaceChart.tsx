import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, TrendingUp, Trophy } from "lucide-react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useIsMobile } from "@/hooks/use-mobile";

interface RaceCandidate {
  id: string;
  displayName: string;
  category: string;
  imageSlug: string | null;
  avatar: string | null;
  seedVotes: number;
}

interface InductionRaceChartProps {
  /** Candidates pre-sorted descending by votes (already filtered to the active category). */
  candidates: RaceCandidate[];
  /** Human label of the active category filter, for the header context line. */
  categoryLabel?: string;
}

const MAX_BAR_HEIGHT = 200;
const MIN_BAR_HEIGHT = 28;

/** Cyan -> teal -> slate gradient by rank position (leader brightest). */
function getBarColor(position: number) {
  // position: 0 (leader) .. 1 (last)
  let r: number, g: number, b: number;
  if (position < 0.5) {
    const t = position * 2; // cyan -> teal
    r = Math.round(34 + (20 - 34) * t);
    g = Math.round(211 + (184 - 211) * t);
    b = Math.round(238 + (166 - 238) * t);
  } else {
    const t = (position - 0.5) * 2; // teal -> muted slate
    r = Math.round(20 + (100 - 20) * t);
    g = Math.round(184 + (116 - 184) * t);
    b = Math.round(166 + (139 - 166) * t);
  }
  return {
    solid: `rgb(${r}, ${g}, ${b})`,
    glow: `rgba(${r}, ${g}, ${b}, 0.45)`,
  };
}

export function InductionRaceChart({ candidates, categoryLabel }: InductionRaceChartProps) {
  const isMobile = useIsMobile();
  const [displayCount, setDisplayCount] = useState<10 | 20 | 30>(10);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const userChoseRef = useRef(false);

  // Seed the responsive default once: Top 20 on desktop, Top 10 on mobile.
  // Guarded so it never overrides a manual selection.
  useEffect(() => {
    if (userChoseRef.current) return;
    setDisplayCount(isMobile ? 10 : 20);
  }, [isMobile]);

  const selectCount = (n: 10 | 20 | 30) => {
    userChoseRef.current = true;
    setDisplayCount(n);
  };

  // Step the toggle down to the largest supported tier when the filtered set shrinks.
  useEffect(() => {
    if (displayCount === 30 && candidates.length <= 20) {
      setDisplayCount(candidates.length <= 10 ? 10 : 20);
    } else if (displayCount === 20 && candidates.length <= 10) {
      setDisplayCount(10);
    }
  }, [candidates.length, displayCount]);

  if (candidates.length === 0) return null;

  const topPeople = candidates.slice(0, displayCount);
  const maxVotes = Math.max(...topPeople.map((p) => p.seedVotes), 1);

  const leader = candidates[0];
  const runnerUp = candidates[1];
  const scoreDiff = leader && runnerUp ? leader.seedVotes - runnerUp.seedVotes : 0;
  const showToggle = candidates.length > 10;
  const tierOptions = ([10, 20, 30] as const).filter((n) => n === 10 || candidates.length > n - 10);
  const isDense = displayCount >= 20;

  return (
    <div className="pulse-card-cyan pulse-card-flush rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <h3 className="font-semibold text-sm">The Race to Induction</h3>
          <span className="text-xs text-muted-foreground">
            {categoryLabel && categoryLabel !== "All" ? `${categoryLabel} · ` : ""}Top {Math.min(displayCount, topPeople.length)}
          </span>
        </div>
        {showToggle && (
          <div className="flex gap-1.5">
            {tierOptions.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => selectCount(n)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-all ${
                  displayCount === n
                    ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                    : "bg-background border-border/60 text-muted-foreground hover:border-cyan-500/40"
                }`}
                data-testid={`button-race-top-${n}`}
              >
                Top {n}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bars */}
      <div className="px-5 overflow-x-auto overflow-y-visible">
        <div
          className="flex items-end gap-3 pt-16 pb-2"
          style={{ minWidth: `${topPeople.length * (isDense ? 44 : 64)}px` }}
        >
          <AnimatePresence mode="popLayout">
            {topPeople.map((person, index) => {
              const rank = index + 1;
              const position = topPeople.length > 1 ? index / (topPeople.length - 1) : 0;
              const colors = getBarColor(position);
              const barHeight = (person.seedVotes / maxVotes) * MAX_BAR_HEIGHT + MIN_BAR_HEIGHT;
              const isTop3 = rank <= 3;
              const isLeader = rank === 1;

              return (
                <motion.div
                  key={person.id}
                  layout
                  className="relative flex flex-1 flex-col items-center overflow-visible"
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.4, delay: index * 0.04 }}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ maxWidth: isDense ? "40px" : "60px" }}
                >
                  {/* Tooltip */}
                  <AnimatePresence>
                    {hoveredIndex === index && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        className="absolute -top-14 z-50 whitespace-nowrap rounded-lg border border-border bg-background/95 px-3 py-2 shadow-xl backdrop-blur-sm"
                      >
                        <p className="text-sm font-semibold">{person.displayName}</p>
                        <p className="text-xs text-muted-foreground">
                          #{rank} · {person.seedVotes.toLocaleString("en-US")} votes
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Avatar */}
                  <motion.div className="relative mb-2" whileHover={{ scale: 1.1 }} transition={{ duration: 0.2 }}>
                    <PersonAvatar
                      name={person.displayName}
                      avatar={person.avatar}
                      imageSlug={person.imageSlug}
                      imageContext="induction"
                      className={isDense ? "h-8 w-8" : "h-11 w-11"}
                    />
                    {isLeader && (
                      <div className="absolute -top-2 -right-2 rounded-full bg-yellow-500 p-1 shadow">
                        <Crown className="h-3 w-3 text-yellow-900" fill="currentColor" />
                      </div>
                    )}
                  </motion.div>

                  {/* Bar */}
                  <motion.div
                    className="relative w-full overflow-hidden rounded-t-md"
                    style={{
                      height: `${barHeight}px`,
                      backgroundColor: colors.solid,
                      transformOrigin: "bottom",
                      boxShadow: isTop3 ? `0 0 ${isLeader ? "26px" : "16px"} ${isLeader ? "6px" : "3px"} ${colors.glow}` : "none",
                    }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ duration: 0.5, delay: index * 0.04, ease: "easeOut" }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{ background: `linear-gradient(to top, ${colors.solid}00, ${colors.glow})` }}
                    />
                  </motion.div>

                  {/* Rank footer */}
                  <div className="flex w-full items-center justify-center rounded-b-md border-t border-border/60 bg-muted/60 py-1">
                    <span className="font-mono text-xs font-bold text-muted-foreground">#{rank}</span>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Insight line */}
      {leader && runnerUp && (
        <div className="px-5 pb-5 pt-1">
          <div className="flex items-start gap-2.5 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <p className="text-sm">
              <span className="font-semibold">{leader.displayName}</span> leads the queue
              {scoreDiff > 0 ? (
                <>
                  {" — "}
                  <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">
                    {scoreDiff.toLocaleString("en-US")}
                  </span>{" "}
                  {scoreDiff === 1 ? "vote" : "votes"} ahead of #2 {runnerUp.displayName}.
                </>
              ) : (
                <> — neck and neck with #2 {runnerUp.displayName}.</>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
