import { lazy, Suspense } from "react";
import type { AuthReason } from "@/lib/authReturn";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignupReasonHeroPlaceholder } from "@/components/auth/SignupReasonHero";

const SignupReasonHero = lazy(() =>
  import("@/components/auth/SignupReasonHero").then((m) => ({
    default: m.SignupReasonHero,
  })),
);

/**
 * Phase 4 — pre-signup context modal.
 *
 * Renders a centred overlay on LoginPage when the URL carries a recognised
 * ?reason= query param. Variant copy is selected by the `reason` prop.
 * The modal does NOT drive the signup itself — it only adds context.
 * Closing leaves the user on LoginPage with the existing form ready
 * (D6 + brief line 215).
 *
 * Accessibility primitives (focus trap, ESC dismiss, click-outside,
 * body scroll lock, ARIA dialog/aria-modal/aria-labelledby/aria-
 * describedby, portal) are inherited from shadcn Dialog → @radix-ui/
 * react-dialog. tailwindcss-animate handles entrance animation and
 * respects prefers-reduced-motion natively.
 *
 * Lifecycle: LoginPage owns open state derived from ?reason= and
 * conditionally renders this component. All three Radix-detected
 * dismissal paths (X, ESC, click-outside) plus the two CTAs funnel
 * through callback props; LoginPage centralises URL clearing, sign-
 * in/signup mode switching, and focus return to the email input.
 *
 * Direct primitive composition (DialogPortal + DialogOverlay + Dialog-
 * Primitive.Content) is intentional: shadcn's exported DialogContent
 * hardcodes the overlay with no className passthrough, so the lighter-
 * backdrop + stronger-blur override needs the overlay rendered here.
 */

interface VariantCopy {
  heading: string;
  body: string;
  primaryCta: string;
  secondaryCta: string;
  primaryCtaSubtext?: string;
  /** Tailwind class fragment for primary button — cyan = Vote, violet = Predict. */
  primaryAccentClass: string;
}

const SIGNUP_REASON_VARIANTS: Record<AuthReason, VariantCopy> = {
  vote_limit_reached: {
    heading: "You've made your voice heard.",
    body: "Create a free account to keep voting and count toward the live rankings.",
    primaryCta: "Create account",
    secondaryCta: "Already have an account? Sign in.",
    primaryCtaSubtext: "Free to sign up. No credit card.",
    primaryAccentClass:
      "bg-cyan-500 hover:bg-cyan-600 text-white border-cyan-600",
  },
  predict_signup: {
    heading: "You've got the instinct.",
    body: "Create a free account to place predictions and build your track record.",
    primaryCta: "Create account",
    secondaryCta: "Already have an account? Sign in.",
    primaryCtaSubtext: "Free to sign up. No credit card.",
    primaryAccentClass:
      "bg-violet-500 hover:bg-violet-600 text-white border-violet-600",
  },
};

export interface SignupReasonModalProps {
  reason: AuthReason;
  /**
   * Fires for the three Radix-detected dismissal paths (X-button click,
   * ESC keypress, click-outside on backdrop). LoginPage handles URL
   * clearing and focus return.
   */
  onDismiss: () => void;
  /**
   * Primary CTA. LoginPage should ensure isLogin === false (signup mode),
   * clear ?reason=, and focus the email input.
   */
  onContinueToSignUp: () => void;
  /**
   * Secondary CTA. LoginPage should set isLogin === true (sign-in mode),
   * clear ?reason=, and focus the email input.
   */
  onSwitchToSignIn: () => void;
}

export function SignupReasonModal({
  reason,
  onDismiss,
  onContinueToSignUp,
  onSwitchToSignIn,
}: SignupReasonModalProps) {
  const variant = SIGNUP_REASON_VARIANTS[reason];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogPortal>
        {/* Lighter-backdrop, stronger-blur per Linear/Stripe/Notion convention. */}
        <DialogOverlay className="bg-black/50 backdrop-blur-md" />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-2rem)] max-w-md max-h-[85vh] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          data-testid="modal-signup-reason"
        >
          <DialogPrimitive.Close
            className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full opacity-70 ring-offset-background transition-opacity hover:bg-muted/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close"
            data-testid="button-signup-reason-dismiss"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="flex flex-col px-6 pb-6 pt-4">
            <Suspense fallback={<SignupReasonHeroPlaceholder reason={reason} />}>
              <SignupReasonHero reason={reason} />
            </Suspense>

            <div className="flex flex-col space-y-2 text-center">
              <DialogTitle className="text-xl font-semibold leading-tight tracking-tight">
                {variant.heading}
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                {variant.body}
              </DialogDescription>
            </div>

            <div className="mt-5 flex flex-col space-y-2">
              <Button
                type="button"
                size="lg"
                className={cn("w-full min-h-11", variant.primaryAccentClass)}
                onClick={onContinueToSignUp}
                data-testid="button-signup-reason-primary"
              >
                {variant.primaryCta}
              </Button>
              {variant.primaryCtaSubtext ? (
                <p className="text-center text-xs text-muted-foreground">
                  {variant.primaryCtaSubtext}
                </p>
              ) : null}
              <button
                type="button"
                onClick={onSwitchToSignIn}
                className="pt-1 text-center text-sm text-primary hover:underline"
                data-testid="button-signup-reason-secondary"
              >
                {variant.secondaryCta}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
