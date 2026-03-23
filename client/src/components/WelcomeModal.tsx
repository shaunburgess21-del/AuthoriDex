import { TrendingUp, Vote, LineChart } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { OnboardingDrawer, type OnboardingStep } from "@/components/OnboardingDrawer";

const STEPS: readonly OnboardingStep[] = [
  {
    icon: TrendingUp,
    heading: "Explore Rankings",
    description: "Real-time leaderboards of the world's most talked-about people.",
    gradient: "from-sky-500 to-blue-600",
    glow: "shadow-sky-500/25",
  },
  {
    icon: Vote,
    heading: "Cast Your Vote",
    description: "Shape the rankings \u2014 vote on who deserves to rise or fall.",
    gradient: "from-emerald-500 to-green-600",
    glow: "shadow-emerald-500/25",
  },
  {
    icon: LineChart,
    heading: "Make Predictions",
    description: "Predict who\u2019s next to trend and earn rewards for being right.",
    gradient: "from-violet-500 to-purple-600",
    glow: "shadow-violet-500/25",
  },
];

export function WelcomeModal() {
  const [, navigate] = useLocation();
  const { isLoggedIn } = useAuth();

  return (
    <OnboardingDrawer
      storageKey="voxdex_seen_intro"
      steps={STEPS}
      lastStepCta={isLoggedIn ? "Start Exploring" : "Get Started"}
      onComplete={() => {
        if (!isLoggedIn) navigate("/login?mode=signup");
      }}
    />
  );
}
