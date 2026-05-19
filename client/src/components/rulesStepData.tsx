import {
  ArrowLeftRight,
  ArrowUpDown,
  BarChart3,
  Camera,
  CheckCircle,
  Clock,
  Coins,
  Flame,
  Globe,
  LayoutGrid,
  ListChecks,
  Lock,
  MessageSquare,
  MousePointerClick,
  Scale,
  Sparkles,
  Swords,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import type { StepModalStep, StepModalAccent } from "@/components/StepModal";

export type RulesStepConfig = {
  steps: StepModalStep[];
  ctaLabel: string;
  accent: StepModalAccent;
};

export const VOTE_RULES_STEPS: Record<string, RulesStepConfig> = {
  voice: {
    accent: "cyan",
    ctaLabel: "Start Voting →",
    steps: [
      {
        icon: <MessageSquare />,
        headline: "Voice Your Opinion",
        body: "Trending topics. Real debates. Vote on the issues everyone's talking about and see where the world stands.",
      },
      {
        icon: <ThumbsUp />,
        headline: "Support, Neutral, or Oppose",
        body: "Read the topic, pick your stance, and watch the community results update in real time.",
      },
      {
        icon: <Zap />,
        headline: "Earn +25 XP Per Vote",
        body: "Every vote earns XP. Suggest your own poll topics and earn bonus XP when they go live.",
      },
    ],
  },
  matchups: {
    accent: "cyan",
    ctaLabel: "Pick a Side →",
    steps: [
      {
        icon: <Swords />,
        headline: "Head-to-Head Battles",
        body: "People, brands, ideas — anything goes. Pick the winner in quick 1v1 matchups.",
      },
      {
        icon: <MousePointerClick />,
        headline: "Tap to Vote",
        body: "Choose A or B. See instant results showing how your pick compares to everyone else.",
      },
      {
        icon: <Sparkles />,
        headline: "Earn +15 XP Per Vote",
        body: "Every matchup vote earns XP. Suggest your own matchups and earn even more.",
      },
    ],
  },
  opinion: {
    accent: "cyan",
    ctaLabel: "Cast Your Vote →",
    steps: [
      {
        icon: <ListChecks />,
        headline: "Multiple Choice Polls",
        body: "Vote on polls with multiple options and choose the answer you agree with most.",
      },
      {
        icon: <BarChart3 />,
        headline: "See Live Results",
        body: "Watch votes roll in and see how the community is split across all options.",
      },
      {
        icon: <Sparkles />,
        headline: "Earn +15 XP Per Vote",
        body: "Vote, earn XP, and suggest your own polls for the community.",
      },
    ],
  },
  value: {
    accent: "cyan",
    ctaLabel: "Rate Now →",
    steps: [
      {
        icon: <Scale />,
        headline: "Overrated or Underrated?",
        body: "Is public perception of this person accurate? You decide.",
      },
      {
        icon: <ArrowUpDown />,
        headline: "Vote Your View",
        body: "Tap Underrated if they deserve more recognition. Tap Overrated if they get too much hype.",
      },
      {
        icon: <TrendingUp />,
        headline: "Shape the Consensus",
        body: "Your vote updates the split in real time. See if the world agrees with you.",
      },
    ],
  },
  induction: {
    accent: "cyan",
    ctaLabel: "Vote Now →",
    steps: [
      {
        icon: <UserPlus />,
        headline: "Nominate the Next Star",
        body: "Vote for who should be added to the VoxDex leaderboard. You decide the roster.",
      },
      {
        icon: <Trophy />,
        headline: "Weekly Winner Gets In",
        body: "The #1 voted candidate each week gets inducted to the main leaderboard.",
      },
      {
        icon: <Zap />,
        headline: "Earn +30 XP Per Vote",
        body: "Induction votes are the highest-earning votes on VoxDex.",
      },
    ],
  },
  curate: {
    accent: "cyan",
    ctaLabel: "Start Curating →",
    steps: [
      {
        icon: <Camera />,
        headline: "Be the Art Director",
        body: "Choose the official profile photo for every celebrity on VoxDex.",
      },
      {
        icon: <ArrowLeftRight />,
        headline: "Swipe to Vote",
        body: "Swipe left or right on profile photos. The community winner becomes the official image.",
      },
      {
        icon: <Sparkles />,
        headline: "Earn +20 XP Per Vote",
        body: "Your votes shape how every celebrity looks across the platform.",
      },
    ],
  },
  governance: {
    accent: "cyan",
    ctaLabel: "Let's Go →",
    steps: [
      {
        icon: <Users />,
        headline: "You Run the Show",
        body: "No editors, no gatekeepers. VoxDex is 100% shaped, ranked, and managed by you.",
      },
      {
        icon: <UserPlus />,
        headline: "Expand the Roster",
        body: "Vote in the Induction Queue to decide who deserves a spot on the leaderboard.",
      },
      {
        icon: <Camera />,
        headline: "Define the Look",
        body: "Use Curate Profile to choose the definitive image for every celebrity. You're the art director.",
      },
    ],
  },
};

export const PREDICT_RULES_STEPS: Record<string, RulesStepConfig> = {
  predictions: {
    accent: "violet",
    ctaLabel: "Start Predicting →",
    steps: [
      {
        icon: <TrendingUp />,
        headline: "Predict the Future",
        body: "Stake credits on what you think will happen. Prove you know who the world is paying attention to.",
      },
      {
        icon: <Coins />,
        headline: "Stake Credits, Win More",
        body: "Every prediction costs credits. Get it right and you win a share of the pool. All credits are virtual — no real money.",
      },
      {
        icon: <LayoutGrid />,
        headline: "Five Ways to Play",
        body: "Weekly Jackpot, Up or Down, Head-to-Head, Category Races, and World Markets. Each has different rules and rewards.",
      },
      {
        icon: <Trophy />,
        headline: "Climb the Leaderboard",
        body: "Your prediction P&L tracks your performance. The best predictors earn bragging rights.",
      },
    ],
  },
  community: {
    accent: "violet",
    ctaLabel: "Explore Markets →",
    steps: [
      {
        icon: <Globe />,
        headline: "Real-World Predictions",
        body: "Will it happen? Elections, acquisitions, viral moments — predict the outcome of verifiable global events.",
      },
      {
        icon: <CheckCircle />,
        headline: "Yes or No",
        body: "Each market has a clear outcome. Stake your credits on what you believe will happen.",
      },
      {
        icon: <Scale />,
        headline: "Public Resolution",
        body: "Markets settle on definitive public information. Each winning share pays 1 credit — cheaper shares pay multiples, and you can sell anytime before close.",
      },
    ],
  },
  jackpot: {
    accent: "amber",
    ctaLabel: "Enter the Jackpot →",
    steps: [
      {
        icon: <Target />,
        headline: "Guess the Exact Score",
        body: "Predict what a celebrity's Trend Score will be at Sunday close. Closest guess wins the entire pool.",
      },
      {
        icon: <Lock />,
        headline: "Your Number is Yours",
        body: "Every number can only be claimed by one person. First come, first served.",
      },
      {
        icon: <Coins />,
        headline: "100 Credits Per Entry",
        body: "Each prediction costs 100 credits. Enter as many times as you want across different celebrities.",
      },
      {
        icon: <Clock />,
        headline: "Entries Close Friday",
        body: "All entries lock at Friday 23:59 UTC. The closest guess at Sunday close wins the pool.",
      },
    ],
  },
  updown: {
    accent: "violet",
    ctaLabel: "Make Your Call →",
    steps: [
      {
        icon: <ArrowUpDown />,
        headline: "Above or Below?",
        body: "A baseline score is locked each Monday. Predict whether the closing score on Sunday will finish above or below it.",
      },
      {
        icon: <TrendingUp />,
        headline: "Pick UP or DOWN",
        body: "UP wins if the score finishes above the baseline. DOWN wins if it finishes below. Exact tie = full refund.",
      },
      {
        icon: <Users />,
        headline: "Trade In and Out",
        body: "Each winning share pays 1 credit at close. Cheaper shares pay multiples if your side wins — sell anytime before close to lock in profits or cut losses.",
      },
    ],
  },
  h2h: {
    accent: "violet",
    ctaLabel: "Pick a Winner →",
    steps: [
      {
        icon: <Swords />,
        headline: "Who Finishes Higher?",
        body: "Two celebrities, one week. Predict who will have the higher closing Trend Score on Sunday.",
      },
      {
        icon: <Target />,
        headline: "Closing Score Decides",
        body: "It's not about who gained more during the week. The final closing score determines the winner.",
      },
      {
        icon: <Trophy />,
        headline: "1 Credit Per Winning Share",
        body: "Share prices move with the crowd as news drops. Each winning share pays 1 credit at close — sell early to lock in a profit before the buzzer.",
      },
    ],
  },
  gainer: {
    accent: "violet",
    ctaLabel: "Spot the Climber →",
    steps: [
      {
        icon: <Flame />,
        headline: "Pick the Biggest Mover",
        body: "Who will have the highest percentage gain in their category this week? Find the momentum.",
      },
      {
        icon: <TrendingUp />,
        headline: "Percentage Gain Wins",
        body: "It's not about who's ranked highest — it's about who moves the most. Underdogs with big spikes beat frontrunners who barely move.",
      },
      {
        icon: <Sparkles />,
        headline: "Spot the Underdog",
        body: "Look for lower-ranked people with upward momentum. A small name with a big week beats a big name standing still.",
      },
    ],
  },
};
