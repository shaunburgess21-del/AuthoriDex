import { TrendingUp, Target, Trophy, Swords, BarChart3, Globe, HelpCircle, Crown, Hash, Clock } from "lucide-react";

export interface RulesStep {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export interface RulesEntry {
  title: string;
  description: string;
  steps: RulesStep[];
}

export const RULES_CONTENT: Record<string, RulesEntry> = {
  jackpot: {
    title: "How the Weekly Jackpot Works",
    description: "Predict the exact closing Trend Score for any person on the leaderboard. The closest guess wins the entire prize pool.",
    steps: [
      { icon: <Target className="h-4 w-4 text-amber-500" />, title: "Pick a Number", description: "Predict what this person's Trend Score will be when the market closes on Sunday at 23:59 UTC. The closer your guess, the better." },
      { icon: <Hash className="h-4 w-4 text-amber-500" />, title: "Your Number is Yours", description: "Every number can only be claimed by one person — first come, first served. Enter early in the week while the best numbers are still available." },
      { icon: <Crown className="h-4 w-4 text-amber-500" />, title: "100 Credits Per Entry", description: "Each prediction costs 100 credits. You can enter multiple times with different numbers to improve your chances." },
      { icon: <Clock className="h-4 w-4 text-amber-500" />, title: "Entries Close Friday 23:59 UTC", description: "You have until Friday at 23:59 UTC to enter. After that, the jackpot is locked and no more entries are accepted." },
      { icon: <Trophy className="h-4 w-4 text-amber-500" />, title: "Closest Guess Wins", description: "When the market closes on Sunday, whoever predicted the closest score wins the entire pool. If two players are equally close, they split it equally." },
    ]
  },
  updown: {
    title: "How Up/Down Works",
    description: "Each week, a fixed baseline score is captured at market open (Monday 00:00 UTC). Everyone predicts whether the final score at close (Sunday 23:59 UTC) finishes above or below that same baseline.",
    steps: [
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Fixed Baseline", description: "A baseline score is locked at the start of each market period. All participants stake against this same reference point — not their personal entry time." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Pick UP or DOWN", description: "UP wins if the closing score finishes above the baseline. DOWN wins if it finishes below. Exact tie = full refund for all positions." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Payout Depends on the Crowd", description: "All stakes go into one pool. If most people pick Up and you also pick Up, you share with the crowd — smaller payout. If you go against the crowd and win, you get a much bigger share. The contrarian edge: going against popular opinion is riskier, but the reward is much higher." },
    ]
  },
  h2h: {
    title: "How Head-to-Head Settles",
    description: "Predict who will finish the week with the higher Trend Score at market close.",
    steps: [
      { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Pick The Higher Closer", description: "Choose which person you think will have the higher Trend Score when the weekly market closes." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Closing Score Decides", description: "This market settles on the final closing Trend Score at weekly close, not on who gained more points during the week." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Winner Takes the Pool", description: "If your pick finishes with the higher closing Trend Score, you split the total pool with other winners." },
    ]
  },
  gainer: {
    title: "How Category Races Work",
    description: "Pick who will be the biggest mover in their category this week.",
    steps: [
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Biggest Mover Wins", description: "The winner is whoever has the highest % gain in their Trend Score by Sunday close — not the highest ranked person." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Spot the Climber", description: "Look for people with momentum — news cycles, viral moments, or rising buzz can push someone's score up fast." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Underdogs Can Win", description: "A lower-ranked person with a big % spike beats a top-ranked person who barely moves. Pick smart, not obvious." },
    ]
  },
  community: {
    title: "World Markets",
    description: "These markets track verifiable global events (e.g., elections, business acquisitions, viral moments). Predictions are settled based on definitive public outcomes.",
    steps: [
      { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "Verifiable Events", description: "Markets are based on real-world outcomes that can be publicly verified - elections, acquisitions, viral milestones, and more." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Yes/No Predictions", description: "Each market has a clear binary outcome. Stake your credits on what you believe will happen." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Public Resolution", description: "Markets are settled based on definitive public information. Winners split the pool proportionally." },
    ]
  },
  predictions: {
    title: "Welcome to Predictions",
    description: "Make predictions on the world's most talked-about people and win credits. Credits are virtual — climb the prediction leaderboard and prove you know who the world is paying attention to.",
    steps: [
      { icon: <Crown className="h-4 w-4 text-amber-500" />, title: "Weekly Jackpot", description: "Guess the exact closing Trend Score for any person. Closest guess wins the pool. Entries close Friday 23:59 UTC." },
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Up or Down", description: "Predict whether someone's Trend Score will finish above or below their weekly baseline. The less popular your pick, the bigger the potential payout." },
      { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Head-to-Head", description: "Pick who will have the higher Trend Score at close. Back the underdog for bigger rewards." },
      { icon: <BarChart3 className="h-4 w-4 text-violet-500" />, title: "Category Races", description: "Pick the biggest mover in each category. Whoever has the highest % gain in their Trend Score by Sunday wins." },
      { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "World Markets", description: "Predict the outcome of verifiable global events — elections, acquisitions, viral milestones, and more." },
    ]
  }
};

export function RulesExplainer({ title, description, steps }: RulesEntry) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <HelpCircle className="h-5 w-5 text-violet-500 shrink-0" />
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">{description}</p>

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-500/15 dark:bg-violet-500/10 flex items-center justify-center shrink-0">
              {step.icon}
            </div>
            <div>
              <h4 className="font-semibold text-sm">{step.title}</h4>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

