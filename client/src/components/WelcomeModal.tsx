import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Vote, LineChart, Sparkles, X, ArrowRight } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "voxdex_seen_intro";

const STEPS = [
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
] as const;

function HowItWorksToast({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 80, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex items-center gap-3 rounded-full border border-border/50 bg-background/80 px-4 py-2.5 shadow-lg shadow-black/20 backdrop-blur-xl">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          New here?
        </span>
        <button
          onClick={onOpen}
          className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 whitespace-nowrap"
        >
          How It Works
        </button>
        <button
          onClick={onDismiss}
          className="ml-0.5 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

function StepContent({ step, direction }: { step: number; direction: number }) {
  const { icon: Icon, heading, description, gradient, glow } = STEPS[step];

  return (
    <motion.div
      key={step}
      initial={{ x: direction > 0 ? 200 : -200, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: direction > 0 ? -200 : 200, opacity: 0 }}
      transition={{ type: "spring", damping: 28, stiffness: 300 }}
      className="flex flex-col items-center text-center px-6 pb-2"
    >
      <div
        className={`mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} shadow-lg ${glow}`}
      >
        <Icon className="h-10 w-10 text-white" strokeWidth={1.5} />
      </div>
      <h3 className="text-2xl font-bold tracking-tight font-sans mb-2">
        {heading}
      </h3>
      <p className="text-base text-muted-foreground max-w-xs leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}

export function WelcomeModal() {
  const [showToast, setShowToast] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [, navigate] = useLocation();
  const { isLoggedIn } = useAuth();

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setShowToast(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const markSeen = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
  }, []);

  function dismissToast() {
    setShowToast(false);
    markSeen();
  }

  function openDrawer() {
    setShowToast(false);
    setDrawerOpen(true);
  }

  function closeDrawer(open: boolean) {
    if (!open) {
      setDrawerOpen(false);
      markSeen();
      setStep(0);
      setDirection(1);
    }
  }

  function nextStep() {
    if (step < STEPS.length - 1) {
      setDirection(1);
      setStep((s) => s + 1);
    }
  }

  function handleGetStarted() {
    setDrawerOpen(false);
    markSeen();
    setStep(0);
    if (isLoggedIn) return;
    navigate("/login?mode=signup");
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <>
      <AnimatePresence>
        {showToast && (
          <HowItWorksToast onOpen={openDrawer} onDismiss={dismissToast} />
        )}
      </AnimatePresence>

      <Drawer open={drawerOpen} onOpenChange={closeDrawer}>
        <DrawerContent className="max-h-[70vh] focus:outline-none">
          <DrawerTitle className="sr-only">How It Works</DrawerTitle>
          <DrawerDescription className="sr-only">
            Learn how VoxDex works in three simple steps
          </DrawerDescription>

          <div className="flex flex-col items-center px-4 pt-4 pb-6">
            {/* Step indicator dots */}
            <div className="flex items-center gap-2 mb-8">
              {STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step
                      ? "w-6 bg-primary"
                      : "w-1.5 bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>

            {/* Step content with animation */}
            <div className="relative w-full overflow-hidden min-h-[200px] flex items-center justify-center">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <StepContent step={step} direction={direction} />
              </AnimatePresence>
            </div>

            {/* Action button */}
            <button
              onClick={isLastStep ? handleGetStarted : nextStep}
              className={`mt-6 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-200 ${
                isLastStep
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {isLastStep ? (isLoggedIn ? "Start Exploring" : "Get Started") : "Next"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
