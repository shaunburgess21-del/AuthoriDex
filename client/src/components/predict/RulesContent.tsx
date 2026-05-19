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
    description: "Each week, a fixed baseline score is captured at market open (Monday 00:00 UTC). Buy UP or DOWN shares — each winning share pays 1 credit at close.",
    steps: [
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Fixed Baseline", description: "A baseline score is locked at the start of each market period. Every share trades against the same reference point until close on Sunday 23:59 UTC." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Buy UP or DOWN Shares", description: "Each share you buy pays 1 credit if your side wins. UP wins if the closing score finishes above the baseline; DOWN wins if it finishes below. Exact tie = full refund." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Price = Crowd Probability", description: "Live share prices reflect the crowd's view in real time — a 0.30 cr share implies a 30% chance. Cheaper shares pay more if your side wins. Sell anytime before close to lock in profits or cut losses." },
    ]
  },
  h2h: {
    title: "How Head-to-Head Works",
    description: "Buy shares of the person you think will finish the week with the higher Trend Score. Winning shares pay 1 credit each at close.",
    steps: [
      { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Pick The Higher Closer", description: "Buy shares of the person you think will have the higher Trend Score when the weekly market closes." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Closing Score Decides", description: "This market settles on the final closing Trend Score at weekly close, not on who gained more points during the week. Ties refund." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Trade Anytime, Pay 1cr/Win", description: "Share prices move with the crowd as news drops. Each winning share pays 1 credit at close, so cheaper shares pay bigger multiples — and you can sell early to lock in a profit before the buzzer." },
    ]
  },
  gainer: {
    title: "How Category Races Work",
    description: "Buy shares of the candidate you think will be the biggest mover. Winning shares pay 1 credit each at close.",
    steps: [
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Biggest Mover Wins", description: "The winner is whoever has the highest % gain in their Trend Score by Sunday close — not the highest ranked person." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Spot the Climber", description: "Look for people with momentum — news cycles, viral moments, or rising buzz can push someone's score up fast. Buy their shares cheap, before the crowd catches on." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Underdogs Pay More", description: "Long-shot candidates trade at lower prices, so winning shares pay a multiple of what you paid. Pick smart and let the curve work for you." },
    ]
  },
  community: {
    title: "World Markets",
    description: "These markets track verifiable global events (elections, business acquisitions, viral moments). Buy Yes or No shares — winners pay 1 credit per share on resolution.",
    steps: [
      { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "Verifiable Events", description: "Markets are based on real-world outcomes that can be publicly verified — elections, acquisitions, viral milestones, and more." },
      { icon: <Target className="h-4 w-4 text-violet-500" />, title: "Yes/No Shares", description: "Buy Yes shares if you think the event happens, No shares if you think it doesn't. Each winning share pays 1 credit on resolution." },
      { icon: <Trophy className="h-4 w-4 text-violet-500" />, title: "Sell Anytime Before Close", description: "Share prices move as news breaks. Cheaper shares pay bigger multiples on a win — sell early to lock in a profit or cut losses, or hold to settlement for the full 1 credit per winning share." },
    ]
  },
  predictions: {
    title: "Welcome to Predictions",
    description: "Trade shares on the world's most talked-about people. Credits are virtual — climb the prediction leaderboard and prove you know who the world is paying attention to.",
    steps: [
      { icon: <Crown className="h-4 w-4 text-amber-500" />, title: "Weekly Jackpot", description: "Guess the exact closing Trend Score for any person. Closest guess wins the pool. Entries close Friday 23:59 UTC." },
      { icon: <TrendingUp className="h-4 w-4 text-violet-500" />, title: "Up or Down", description: "Buy UP or DOWN shares on whether someone's Trend Score finishes above or below their weekly baseline. Winning shares pay 1 credit at close." },
      { icon: <Swords className="h-4 w-4 text-violet-500" />, title: "Head-to-Head", description: "Buy shares of the person you think will close higher. Trade in and out as news shifts the price." },
      { icon: <BarChart3 className="h-4 w-4 text-violet-500" />, title: "Category Races", description: "Buy shares of the biggest mover in each category. Whoever has the highest % gain in their Trend Score by Sunday wins." },
      { icon: <Globe className="h-4 w-4 text-violet-500" />, title: "World Markets", description: "Trade Yes/No shares on verifiable global events — elections, acquisitions, viral milestones, and more." },
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

