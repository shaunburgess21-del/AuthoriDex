import { forwardRef } from "react";

import { TrendingUp, Vote, LineChart } from "lucide-react";

import { useLocation } from "wouter";

import { useAuth } from "@/contexts/AuthContext";
import { navigateToLogin } from "@/lib/authReturn";
import { isQuickVoteNudgeEligible } from "@/lib/quickVoteNudge";
import { isSessionInterruptUsed } from "@/lib/interruptArbiter";

import { OnboardingDrawer, type OnboardingStep, type OnboardingDrawerHandle } from "@/components/OnboardingDrawer";



const STEPS: readonly OnboardingStep[] = [

  {

    icon: TrendingUp,

    heading: "Explore Rankings",

    description: "Live leaderboards of the people shaping culture, media, and global conversation.",

    gradient: "from-sky-500 to-blue-600",

    glow: "shadow-sky-500/25",

  },

  {

    icon: Vote,

    heading: "Cast Your Vote",

    description: "Weigh in on people, topics, and debates \u2014 and help shape what the world thinks.",

    gradient: "from-emerald-500 to-green-600",

    glow: "shadow-emerald-500/25",

  },

  {

    icon: LineChart,

    heading: "Make Predictions",

    description: "Call it before it happens — on the leaderboard and in the real world.",

    gradient: "from-violet-500 to-purple-600",

    glow: "shadow-violet-500/25",

  },

];



export const WelcomeModal = forwardRef<OnboardingDrawerHandle>(function WelcomeModal(_props, ref) {

  const [, navigate] = useLocation();

  const { isLoggedIn } = useAuth();

  // Interrupt arbitration: when the Quick Vote entry pill is eligible for
  // this visitor, it takes priority — suppress this drawer's auto toast so
  // only one interrupt fires per session. The drawer still opens via ref /
  // footer links for every cohort. The session-slot check matters on
  // re-renders: once the pill fires it CONSUMES the slot, which flips
  // eligibility to false — without the slot check the toast would un-suppress
  // mid-session and both interrupts would show.
  const quickVotePillEligible = isQuickVoteNudgeEligible(isLoggedIn);

  return (

    <OnboardingDrawer

      ref={ref}

      storageKey="voxdex_seen_intro"

      steps={STEPS}

      lastStepCta={isLoggedIn ? "Start Exploring" : "Get Started"}

      disableAutoToast={isLoggedIn || quickVotePillEligible || isSessionInterruptUsed()}

      onComplete={() => {

        if (!isLoggedIn) navigateToLogin(navigate, { mode: "signup" });

      }}

    />

  );

});


