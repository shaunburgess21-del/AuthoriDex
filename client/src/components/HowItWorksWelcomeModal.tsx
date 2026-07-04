import { forwardRef } from "react";

import { BookOpen, Trophy, Coins, Sparkles } from "lucide-react";

import {
  OnboardingDrawer,
  type OnboardingStep,
  type OnboardingDrawerHandle,
} from "@/components/OnboardingDrawer";

/**
 * Orientation flow for the How It Works page. On a visitor's first visit
 * (anonymous or signed-in), a floating pill invites them to take the tour;
 * the drawer only opens when they tap it. Replay anytime from the page footer.
 * Copy is intentionally jargon-free — the tabs are the deep dive.
 */
const STEPS: readonly OnboardingStep[] = [
  {
    icon: BookOpen,
    heading: "Welcome to How It Works",
    description:
      "A quick tour of how VoxDex rewards you for joining in. Swipe through, then explore the tabs up top whenever you want the full detail.",
    gradient: "from-sky-500 to-blue-600",
    glow: "shadow-sky-500/25",
  },
  {
    icon: Trophy,
    heading: "Earn XP & climb the ranks",
    description:
      "Vote, predict, comment, and log in daily to earn XP. The more you take part, the higher your rank — boosting what you earn and the credibility you carry across VoxDex.",
    gradient: "from-amber-500 to-orange-600",
    glow: "shadow-amber-500/25",
  },
  {
    icon: Coins,
    heading: "Vox, your prediction currency",
    description:
      "Vox is the in-app currency you use for predictions. Spend it to back your calls and win more back when you're right — and earn Vox just by staying active.",
    gradient: "from-violet-500 to-purple-600",
    glow: "shadow-violet-500/25",
  },
  {
    icon: Sparkles,
    heading: "Collect badges & dig in",
    description:
      "Badges track your milestones automatically as you play. Tap any tab above — XP, Ranks, Vox, Badges, Vote, or Predict — to learn more.",
    gradient: "from-emerald-500 to-green-600",
    glow: "shadow-emerald-500/25",
  },
];

export const HowItWorksWelcomeModal = forwardRef<OnboardingDrawerHandle>(
  function HowItWorksWelcomeModal(_props, ref) {
    return (
      <OnboardingDrawer
        ref={ref}
        storageKey="voxdex_seen_how_it_works"
        steps={STEPS}
        toastLabel="First time here?"
        toastCtaLabel="Take the tour"
        lastStepCta="Got it"
        reShowAfterDays={Infinity}
      />
    );
  },
);
