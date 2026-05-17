/**
 * StepShell — shared frame for every onboarding step.
 *
 * Provides:
 *   - Top bar with optional Back (left) and Skip (right) controls.
 *   - Step progress indicator (segmented bar — see ProgressIndicator).
 *   - Title + optional subtitle in a consistent type scale.
 *   - Slot for step-specific content.
 *   - Footer slot (typically a Continue button).
 *
 * The container owns navigation; this component is purely presentational
 * so each step can stay focused on its own UI.
 */
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StepShellProps {
  stepIndex: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onSkip?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Hide the progress bar (used on the completion screen). */
  hideProgress?: boolean;
  testId?: string;
}

export function StepShell({
  stepIndex,
  totalSteps,
  title,
  subtitle,
  onBack,
  onSkip,
  children,
  footer,
  hideProgress = false,
  testId,
}: StepShellProps) {
  return (
    <div
      className="flex min-h-[100dvh] w-full flex-col bg-background text-foreground"
      data-testid={testId}
    >
      {/* Top bar — sticky so Back + Skip stay reachable on long content. */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="min-w-[44px]">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="onboarding-back"
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <div className="flex-1">
          {!hideProgress && (
            <ProgressIndicator current={stepIndex} total={totalSteps} />
          )}
        </div>
        <div className="min-w-[44px] text-right">
          {onSkip ? (
            <button
              type="button"
              onClick={onSkip}
              className="-mr-2 inline-flex h-9 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              data-testid="onboarding-skip"
            >
              Skip
            </button>
          ) : null}
        </div>
      </div>

      {/* Body — centered column, generous breathing room. */}
      <div className="flex flex-1 flex-col px-5 pt-6 pb-4 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto w-full max-w-md"
        >
          <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </motion.div>

        <div className="mx-auto mt-8 flex w-full max-w-md flex-1 flex-col">
          {children}
        </div>
      </div>

      {/* Footer — sticky CTA. The mx-auto + max-w-md keeps the button
          aligned with the body content even on wide viewports. */}
      {footer ? (
        <div className="sticky bottom-0 left-0 right-0 border-t border-border/40 bg-background/80 px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-4 backdrop-blur sm:px-8">
          <div className="mx-auto w-full max-w-md">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

interface ProgressIndicatorProps {
  current: number;
  total: number;
}

/**
 * Segmented progress bar. Each step is a pill that fills as the user
 * advances. Active step glows; completed steps are solid; pending
 * steps are faint. Reads as a "you are here" affordance.
 */
function ProgressIndicator({ current, total }: ProgressIndicatorProps) {
  return (
    <div
      className="flex items-center justify-center gap-1.5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={current}
      data-testid="onboarding-progress"
    >
      {Array.from({ length: total }).map((_, i) => {
        const state =
          i < current ? "complete" : i === current ? "active" : "pending";
        return (
          <span
            key={i}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              state === "active" &&
                "w-6 bg-primary shadow-[0_0_12px_-2px_hsl(var(--primary))]",
              state === "complete" && "w-6 bg-primary/70",
              state === "pending" && "w-3 bg-muted-foreground/25",
            )}
          />
        );
      })}
    </div>
  );
}
