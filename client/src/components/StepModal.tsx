"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StepModalStep = {
  icon: ReactNode;
  headline: string;
  body: string | ReactNode;
};

export type StepModalAccent = "cyan" | "violet" | "amber";

const ACCENT_CLASSES: Record<
  StepModalAccent,
  {
    iconBg: string;
    iconText: string;
    activeDot: string;
    ctaGradient: string;
  }
> = {
  cyan: {
    iconBg: "bg-cyan-500/15 dark:bg-cyan-500/10",
    iconText: "text-cyan-600 dark:text-cyan-400",
    activeDot: "bg-cyan-600 dark:bg-cyan-400",
    ctaGradient: "from-cyan-500 via-violet-500 to-fuchsia-500",
  },
  violet: {
    iconBg: "bg-violet-500/15 dark:bg-violet-500/10",
    iconText: "text-violet-600 dark:text-violet-400",
    activeDot: "bg-violet-600 dark:bg-violet-400",
    ctaGradient: "from-violet-600 via-fuchsia-600 to-pink-600",
  },
  amber: {
    iconBg: "bg-amber-500/15 dark:bg-amber-500/10",
    iconText: "text-amber-600 dark:text-amber-400",
    activeDot: "bg-amber-600 dark:bg-amber-400",
    ctaGradient: "from-amber-500 via-orange-500 to-rose-500",
  },
};

export type StepModalProps = {
  open: boolean;
  onClose: () => void;
  steps: StepModalStep[];
  ctaLabel: string;
  onCtaClick?: () => void;
  title?: string;
  accent?: StepModalAccent;
};

const SWIPE_THRESHOLD = 40;

export function StepModal({
  open,
  onClose,
  steps,
  ctaLabel,
  onCtaClick,
  title,
  accent = "cyan",
}: StepModalProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const dragStartX = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStepIdx(0);
      setDirection(1);
    }
  }, [open]);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;
  const accentClasses = ACCENT_CLASSES[accent];

  const goNext = () => {
    if (isLast) {
      onCtaClick?.();
      onClose();
    } else {
      setDirection(1);
      setStepIdx((i) => i + 1);
    }
  };

  const goPrev = () => {
    if (stepIdx > 0) {
      setDirection(-1);
      setStepIdx((i) => i - 1);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - dragStartX.current;
    dragStartX.current = null;
    if (delta < -SWIPE_THRESHOLD) goNext();
    else if (delta > SWIPE_THRESHOLD) goPrev();
  };

  if (!step) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 w-[calc(100%-2rem)] max-w-sm max-h-[85vh] translate-x-[-50%] translate-y-[-50%] overflow-hidden rounded-2xl border bg-card shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">
            {title ?? step.headline}
          </DialogPrimitive.Title>

          <div
            className="relative flex flex-col"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
              data-testid="step-modal-skip"
            >
              Skip
            </button>

            <div className="flex items-center justify-center gap-1.5 pt-6 pb-2">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2 rounded-full transition-all duration-200",
                    i === stepIdx
                      ? cn("w-6", accentClasses.activeDot)
                      : "w-2 bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>

            <div className="relative flex min-h-[300px] items-center justify-center overflow-hidden px-6 py-6">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={stepIdx}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -direction * 40 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex w-full flex-col items-center"
                >
                  <div
                    className={cn(
                      "mb-6 flex h-20 w-20 items-center justify-center rounded-full",
                      accentClasses.iconBg,
                    )}
                  >
                    <div
                      className={cn(
                        "[&_svg]:h-10 [&_svg]:w-10",
                        accentClasses.iconText,
                      )}
                    >
                      {step.icon}
                    </div>
                  </div>
                  <h2 className="mb-3 text-center text-xl font-bold leading-tight text-foreground">
                    {step.headline}
                  </h2>
                  <div className="mx-auto max-w-xs text-center text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {step.body}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="px-6 pb-6 pt-2">
              <Button
                onClick={goNext}
                className={cn(
                  "h-11 w-full text-white shadow-md hover:opacity-90",
                  isLast
                    ? cn("bg-gradient-to-r", accentClasses.ctaGradient)
                    : cn("bg-gradient-to-r", accentClasses.ctaGradient, "opacity-80"),
                )}
                data-testid="step-modal-cta"
              >
                {isLast ? ctaLabel : "Next →"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
