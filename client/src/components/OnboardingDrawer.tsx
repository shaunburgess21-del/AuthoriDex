import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight, type LucideIcon } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";

const RE_SHOW_DAYS = 21;
const MS_PER_DAY = 86_400_000;

function sessionToastDismissedKey(storageKey: string) {
  return `${storageKey}_toast_dismissed_session`;
}

function isSessionToastDismissed(storageKey: string): boolean {
  try {
    return sessionStorage.getItem(sessionToastDismissedKey(storageKey)) === "1";
  } catch {
    return false;
  }
}

function markSessionToastDismissed(storageKey: string) {
  try {
    sessionStorage.setItem(sessionToastDismissedKey(storageKey), "1");
  } catch { /* private mode */ }
}

export interface OnboardingStep {
  icon: LucideIcon;
  heading: string;
  description: string;
  gradient: string;
  glow: string;
}

export interface OnboardingDrawerHandle {
  open: () => void;
}

interface Props {
  storageKey: string;
  steps: readonly OnboardingStep[];
  toastLabel?: string;
  /** CTA label on the floating first-visit pill. Defaults to "How It Works". */
  toastCtaLabel?: string;
  lastStepCta?: string;
  onComplete?: () => void;
  delayMs?: number;
  reShowAfterDays?: number;
  /** When true, never auto-show the bottom toast (e.g. signed-in users). Drawer still opens via ref / footer. */
  disableAutoToast?: boolean;
}

function shouldShowToast(storageKey: string, reShowAfterDays: number): boolean {
  if (isSessionToastDismissed(storageKey)) return false;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return true;
    if (raw === "true") return false;
    const ts = Number(raw);
    if (isNaN(ts)) return true;
    return Date.now() - ts > reShowAfterDays * MS_PER_DAY;
  } catch {
    return false;
  }
}

function markSeen(storageKey: string) {
  try {
    localStorage.setItem(storageKey, String(Date.now()));
  } catch { /* private mode */ }
}

function OnboardingToast({
  label,
  ctaLabel,
  onOpen,
  onDismiss,
}: {
  label: string;
  ctaLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-3 md:bottom-6">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="pointer-events-auto flex w-full max-w-[min(100%,24rem)] justify-center"
      >
        <div className="flex w-max max-w-full min-w-0 items-center gap-2 sm:gap-3 rounded-full border border-border/50 bg-background/80 px-3 py-2.5 shadow-lg shadow-black/20 backdrop-blur-xl sm:px-4">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate text-sm text-muted-foreground">{label}</span>
          <button
            type="button"
            onClick={onOpen}
            className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-4"
          >
            {ctaLabel}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="ml-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function StepContent({
  steps,
  step,
  direction,
}: {
  steps: readonly OnboardingStep[];
  step: number;
  direction: number;
}) {
  const { icon: Icon, heading, description, gradient, glow } = steps[step];

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

export const OnboardingDrawer = forwardRef<OnboardingDrawerHandle, Props>(
  function OnboardingDrawer(
    {
      storageKey,
      steps,
      toastLabel = "New here?",
      toastCtaLabel = "How It Works",
      lastStepCta = "Get Started",
      onComplete,
      delayMs = 2000,
      reShowAfterDays = RE_SHOW_DAYS,
      disableAutoToast = false,
    },
    ref,
  ) {
    const [showToast, setShowToast] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);

    useImperativeHandle(ref, () => ({
      open() {
        setShowToast(false);
        setStep(0);
        setDirection(1);
        setDrawerOpen(true);
      },
    }));

    useEffect(() => {
      if (!shouldShowToast(storageKey, reShowAfterDays)) return;
      if (disableAutoToast) return;
      const timer = setTimeout(() => setShowToast(true), delayMs);
      return () => clearTimeout(timer);
    }, [storageKey, delayMs, reShowAfterDays, disableAutoToast]);

    const dismiss = useCallback(() => {
      setShowToast(false);
      markSessionToastDismissed(storageKey);
      markSeen(storageKey);
    }, [storageKey]);

    function openDrawer() {
      setShowToast(false);
      setDrawerOpen(true);
    }

    function closeDrawer(open: boolean) {
      if (!open) {
        setDrawerOpen(false);
        markSeen(storageKey);
        setStep(0);
        setDirection(1);
      }
    }

    function nextStep() {
      if (step < steps.length - 1) {
        setDirection(1);
        setStep((s) => s + 1);
      }
    }

    function prevStep() {
      if (step > 0) {
        setDirection(-1);
        setStep((s) => s - 1);
      }
    }

    function handleComplete() {
      setDrawerOpen(false);
      markSeen(storageKey);
      setStep(0);
      onComplete?.();
    }

    const isLastStep = step === steps.length - 1;

    return (
      <>
        <AnimatePresence>
          {showToast && (
            <OnboardingToast
              label={toastLabel}
              ctaLabel={toastCtaLabel}
              onOpen={openDrawer}
              onDismiss={dismiss}
            />
          )}
        </AnimatePresence>

        <Drawer open={drawerOpen} onOpenChange={closeDrawer}>
          <DrawerContent className="max-h-[70vh] focus:outline-none">
            <DrawerTitle className="sr-only">How It Works</DrawerTitle>
            <DrawerDescription className="sr-only">
              Learn how it works in three simple steps
            </DrawerDescription>

            <div className="flex flex-col items-center px-4 pt-4 pb-6">
              <div data-vaul-no-drag className="w-full">
                <SwipeNavigator
                  onSwipeLeft={nextStep}
                  onSwipeRight={prevStep}
                  disableLeft={isLastStep}
                  disableRight={step === 0}
                  className="flex w-full flex-col items-center"
                >
                  <div className="flex items-center gap-2 mb-8">
                    {steps.map((_, i) => (
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

                  <div className="relative w-full overflow-hidden min-h-[200px] flex items-center justify-center">
                    <AnimatePresence mode="wait" initial={false} custom={direction}>
                      <StepContent steps={steps} step={step} direction={direction} />
                    </AnimatePresence>
                  </div>
                </SwipeNavigator>
              </div>

              <button
                onClick={isLastStep ? handleComplete : nextStep}
                className={`mt-6 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold transition-all duration-200 ${
                  isLastStep
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
                    : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >
                {isLastStep ? lastStepCta : "Next"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </DrawerContent>
        </Drawer>
      </>
    );
  },
);
