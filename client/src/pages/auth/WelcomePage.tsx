/**
 * /login/welcome — multi-step onboarding container.
 *
 * Step order (also persisted in `profiles.onboarding_step`, see
 * migration 0063):
 *
 *   0  Welcome     — avatar + username + ToS         (required)
 *   1  Year born   — scroll-wheel year picker        (skippable)
 *   2  Gender      — tap-to-select                   (skippable)
 *   3  Country     — searchable list                 (skippable)
 *   4  Interests   — InterestsPicker inline mode     (skippable)
 *   5  Completion  — reward / celebration screen     (terminal)
 *
 * Resumability:
 *   The container reads `profile.onboardingStep` on mount and starts
 *   the user at the highest step they've reached. Step 0 always
 *   advances when the user submits a username + ToS (because that's
 *   how `tosAcceptedAt` lands). After every advance/skip we persist
 *   the new step via PATCH /api/profile/me/onboarding-step so a
 *   reload or device-swap picks up where they left off.
 *
 *   onboardingCompletedAt is stamped server-side on entry to step 5
 *   (the completion screen submits a single PATCH that sets it). The
 *   NewUserGate keys on this field — once it's set, the user is
 *   released into the rest of the app and can no longer re-enter
 *   /login/welcome (the bounce-out effect below sends them to /).
 *
 * Animation:
 *   Direction-aware slide between steps via framer-motion. Forward
 *   navigation slides left; back slides right. Animation happens on
 *   the body of the step only — the top bar (progress + skip + back)
 *   stays static so the user always has a stable navigation anchor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { redirectAfterLogin, hasPendingAuthReturnSnapshot } from "@/lib/authReturn";
import { InterestsPicker } from "@/components/interests/InterestsPicker";

import { StepShell } from "./onboarding/StepShell";
import { WelcomeStep } from "./onboarding/WelcomeStep";
import { YearWheel, buildDateOfBirth } from "./onboarding/YearStep";
import { GenderList } from "./onboarding/GenderStep";
import { CountryList } from "./onboarding/CountryStep";
import { CompletionStep } from "./onboarding/CompletionStep";

const TOTAL_STEPS = 6;

type StepId = 0 | 1 | 2 | 3 | 4 | 5;

export default function WelcomePage() {
  const [, setLocation] = useLocation();
  const {
    user,
    loading: authLoading,
    profile,
    profileLoading,
    refreshProfile,
  } = useAuth();

  // Local step state. Initialised from profile.onboardingStep once
  // the profile lands. The `bootstrapped` flag prevents us from
  // animating through a flash of step 0 while the profile loads.
  const [step, setStep] = useState<StepId>(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Per-step staged values. We hold them in container state so the
  // user can hit Back without losing what they typed, and so the
  // Continue button can sit in the footer (outside the step body).
  const [year, setYear] = useState<number | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);

  const advancePersistedRef = useRef<Set<number>>(new Set());

  // Bounce: unauthenticated users go to /login. Returning users with
  // onboarding ALREADY completed go straight home (or back to where
  // they were trying to land via the auth-return snapshot). The
  // tosAcceptedAt-based bounce was previously how this worked; we
  // now key on onboardingCompletedAt so partially-completed users
  // stay in the flow on their next visit.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLocation("/login", { replace: true });
      return;
    }
    if (profileLoading || !profile) return;
    if (profile.onboardingCompletedAt) {
      if (hasPendingAuthReturnSnapshot()) {
        redirectAfterLogin(setLocation);
      } else {
        setLocation("/", { replace: true });
      }
    }
  }, [authLoading, user, profile, profileLoading, setLocation]);

  // Resume at the highest step the user has reached. Clamp to
  // [0, 5] in case a future migration ever sets a wider range.
  useEffect(() => {
    if (bootstrapped) return;
    if (!profile) return;
    const raw = profile.onboardingStep ?? 0;
    const clamped = Math.max(0, Math.min(5, raw)) as StepId;
    setStep(clamped);
    // Pre-populate staged values so the user sees their previous
    // choices when navigating back. This matters more for back-button
    // returns than for cross-device resumes (we never re-render an
    // already-saved demographic step's UI on the next visit because
    // the gate releases them once onboardingCompletedAt is set).
    if (profile.dateOfBirth && /^\d{4}-/.test(profile.dateOfBirth)) {
      const y = Number(profile.dateOfBirth.slice(0, 4));
      if (!Number.isNaN(y)) setYear(y);
    }
    if (profile.gender) setGender(profile.gender);
    if (profile.countryOfResidence) setCountry(profile.countryOfResidence);
    setBootstrapped(true);
  }, [profile, bootstrapped]);

  /** Persist the new highest step. Idempotent; the server clamps. */
  const persistStep = useCallback(async (next: number) => {
    if (advancePersistedRef.current.has(next)) return;
    advancePersistedRef.current.add(next);
    try {
      await apiRequest("PATCH", "/api/profile/me/onboarding-step", {
        step: next,
      });
    } catch (err) {
      // Non-fatal: the next /api/profile/sync will set the right
      // step from the server's perspective. We log + swallow.
      console.warn("[WelcomePage] persist onboarding step failed:", err);
      advancePersistedRef.current.delete(next);
    }
  }, []);

  const goNext = useCallback(
    async (from: StepId) => {
      const next = Math.min(5, from + 1) as StepId;
      setDirection(1);
      setStep(next);
      void persistStep(next);
    },
    [persistStep],
  );

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => (s > 0 ? ((s - 1) as StepId) : s));
  }, []);

  // Step 1 — Year Born: confirm action.
  const submitYear = useCallback(async () => {
    if (year === null) return;
    try {
      await apiRequest("PATCH", "/api/profile/me", {
        dateOfBirth: buildDateOfBirth(year),
      });
      await refreshProfile();
      void goNext(1);
    } catch (err) {
      console.error("[WelcomePage] save year failed:", err);
      toast.error("Couldn't save your year. Please try again.");
    }
  }, [year, refreshProfile, goNext]);

  // Step 2 — Gender: confirm action.
  const submitGender = useCallback(async () => {
    if (!gender) return;
    try {
      await apiRequest("PATCH", "/api/profile/me", { gender });
      await refreshProfile();
      void goNext(2);
    } catch (err) {
      console.error("[WelcomePage] save gender failed:", err);
      toast.error("Couldn't save. Please try again.");
    }
  }, [gender, refreshProfile, goNext]);

  // Step 3 — Country: confirm action.
  const submitCountry = useCallback(async () => {
    if (!country) return;
    try {
      await apiRequest("PATCH", "/api/profile/me", {
        countryOfResidence: country,
      });
      await refreshProfile();
      void goNext(3);
    } catch (err) {
      console.error("[WelcomePage] save country failed:", err);
      toast.error("Couldn't save. Please try again.");
    }
  }, [country, refreshProfile, goNext]);

  // Step 4 — Interests: skip route. The InterestsPicker save path
  // already calls PATCH /api/profile/me/interests internally, so the
  // "saved" callback just needs to advance. The skip path stamps
  // interestsPromptDismissedAt server-side via the same endpoint so
  // the post-onboarding InterestsGate modal won't fire.
  const skipInterests = useCallback(async () => {
    try {
      await apiRequest("PATCH", "/api/profile/me/interests", {
        interests: [],
        dismissed: true,
      });
      await refreshProfile();
    } catch (err) {
      console.warn("[WelcomePage] skip interests failed:", err);
    }
    void goNext(4);
  }, [refreshProfile, goNext]);

  const onInterestsSaved = useCallback(async () => {
    await refreshProfile();
    void goNext(4);
  }, [refreshProfile, goNext]);

  // Step 5 — Completion: stamp onboardingCompletedAt + onboardingStep=5
  // server-side on first render. The completion screen calls onMounted
  // exactly once.
  const onCompletionMounted = useCallback(async () => {
    try {
      await apiRequest("PATCH", "/api/profile/me", {
        onboardingStep: 5,
        onboardingCompletedAt: true,
      });
      await refreshProfile();
    } catch (err) {
      console.warn("[WelcomePage] stamp completion failed:", err);
    }
  }, [refreshProfile]);

  // Direction-aware variants. We slide ~16% of viewport width — wide
  // enough to feel like motion, tight enough to keep the next step
  // landing on the screen quickly.
  const variants = useMemo(
    () => ({
      initial: (dir: 1 | -1) => ({
        x: dir > 0 ? "16%" : "-16%",
        opacity: 0,
      }),
      animate: { x: 0, opacity: 1 },
      exit: (dir: 1 | -1) => ({
        x: dir > 0 ? "-16%" : "16%",
        opacity: 0,
      }),
    }),
    [],
  );

  if (authLoading || !user || !bootstrapped) {
    return null;
  }

  // Top-bar handlers per step.
  const onBack = step > 0 && step < 5 ? goBack : undefined;

  let content: React.ReactNode = null;
  let title = "";
  let subtitle: string | undefined;
  let footer: React.ReactNode = null;
  let onSkip: (() => void) | undefined;
  let hideProgress = false;

  switch (step) {
    case 0:
      title = "Welcome to VoxDex";
      subtitle = "Pick a handle and you're in. You can change it any time.";
      content = (
        <WelcomeStep onCompleted={() => void goNext(0)} />
      );
      // Step 0 owns its own submit button (inside the form). No
      // external footer or back/skip controls.
      break;
    case 1:
      title = "When were you born?";
      subtitle = "Just the year — we use this to tune what you see.";
      onSkip = () => void goNext(1);
      content = (
        <YearWheel
          initialDateOfBirth={profile?.dateOfBirth ?? null}
          onChange={setYear}
        />
      );
      footer = (
        <Button
          onClick={() => void submitYear()}
          className="w-full"
          size="lg"
          disabled={year === null}
          data-testid="year-continue"
        >
          Continue
        </Button>
      );
      break;
    case 2:
      title = "How do you identify?";
      subtitle = "Optional. Helps us serve a more relevant feed.";
      onSkip = () => void goNext(2);
      content = <GenderList value={gender} onChange={setGender} />;
      footer = (
        <Button
          onClick={() => void submitGender()}
          className="w-full"
          size="lg"
          disabled={!gender}
          data-testid="gender-continue"
        >
          Continue
        </Button>
      );
      break;
    case 3:
      title = "Where are you based?";
      subtitle = "Country only. We never share this.";
      onSkip = () => void goNext(3);
      content = <CountryList value={country} onChange={setCountry} />;
      footer = (
        <Button
          onClick={() => void submitCountry()}
          className="w-full"
          size="lg"
          disabled={!country}
          data-testid="country-continue"
        >
          Continue
        </Button>
      );
      break;
    case 4:
      title = "What are you into?";
      subtitle = "Pick a few categories — we'll surface what matters to you.";
      onSkip = () => void skipInterests();
      // The inline picker has its own Save button + selection state,
      // so the container doesn't render an external footer for this
      // step. onInterestsSaved is fired via the picker's onSaved cb.
      content = (
        <InterestsPicker
          mode="inline"
          defaultValue={profile?.statedInterests ?? []}
          onSaved={() => void onInterestsSaved()}
        />
      );
      break;
    case 5:
      title = "";
      hideProgress = true;
      content = <CompletionStep onMounted={() => void onCompletionMounted()} />;
      break;
  }

  return (
    <StepShell
      stepIndex={step}
      totalSteps={TOTAL_STEPS}
      title={title}
      subtitle={subtitle}
      onBack={onBack}
      onSkip={onSkip}
      hideProgress={hideProgress || step === 5}
      footer={footer}
      testId={`onboarding-step-${step}`}
    >
      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.div
          key={step}
          custom={direction}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col"
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </StepShell>
  );
}
