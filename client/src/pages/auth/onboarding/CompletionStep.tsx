/**
 * Step 5 — Completion / reward screen.
 *
 * The moment of delight. Big celebratory header, the user's
 * starting balance + earned XP + earned badges from the flow, and a
 * single CTA. Auto-advances to `/` after 4 seconds if the user
 * hasn't already tapped through.
 *
 * Recent badges are filtered to those earned within the last 10
 * minutes so we surface the awards from THIS onboarding session
 * (signup grants the Day-One badges so a strict "earned during
 * onboarding" filter is too narrow). If the API call fails we fall
 * through to the static rewards block — never block the user from
 * leaving the screen.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Award, Coins, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { redirectAfterLogin, hasPendingAuthReturnSnapshot } from "@/lib/authReturn";
import { logFunnelEvent } from "@/lib/funnelTelemetry";
import { formatVox } from "@/lib/currency";

interface BadgeRow {
  key: string;
  name: string;
  icon: string | null;
  earned: boolean;
  earnedAt: string | null;
  rarity?: string | null;
}

const RECENT_BADGE_WINDOW_MS = 10 * 60 * 1000;

interface CompletionStepProps {
  /** Called once on render so the container can mark onboarding complete. */
  onMounted: () => void;
}

export function CompletionStep({ onMounted }: CompletionStepProps) {
  const [, setLocation] = useLocation();
  const { profile } = useAuth();
  const [badges, setBadges] = useState<BadgeRow[]>([]);

  useEffect(() => {
    onMounted();
  }, [onMounted]);

  // Best-effort badge fetch — if it fails, the screen still renders
  // the credits + XP rewards so the user always sees a payoff.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiRequest("GET", "/api/me/badges");
        const data = (await res.json()) as BadgeRow[];
        if (cancelled) return;
        setBadges(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setBadges([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const recentBadges = useMemo(() => {
    const cutoff = Date.now() - RECENT_BADGE_WINDOW_MS;
    return badges.filter(
      (b) =>
        b.earned &&
        b.earnedAt !== null &&
        b.key !== "avatar_uploaded" &&
        new Date(b.earnedAt).getTime() >= cutoff,
    );
  }, [badges]);

  const finish = useMemo(() => {
    return () => {
      logFunnelEvent("signup_completed", "onboarding", {
        hadReturnSnapshot: hasPendingAuthReturnSnapshot(),
      });
      if (hasPendingAuthReturnSnapshot()) {
        redirectAfterLogin(setLocation);
      } else {
        setLocation("/", { replace: true });
      }
    };
  }, [setLocation]);

  // No auto-advance: users dwell on the rewards screen as long as
  // they want and leave only by tapping the CTA. If they refresh the
  // page mid-dwell, NewUserGate sees onboardingCompletedAt set (we
  // PATCH it on mount) and bounces them straight to /, so getting
  // stuck on this screen forever is impossible.

  const credits = profile?.predictCredits ?? 0;
  const xp = profile?.xpPoints ?? 0;
  const username = profile?.username;

  return (
    <div className="flex flex-1 flex-col">
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-6 text-center"
      >
        <RewardHalo />

        <div>
          <h2 className="font-serif text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {username ? <>Welcome, {username}.</> : <>You're in.</>}
          </h2>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Your account's set up. Here's what you've got to start.
          </p>
        </div>
      </motion.div>

      <div className="mt-8 grid gap-3" data-testid="completion-rewards">
        <RewardRow
          icon={<Coins className="h-5 w-5" />}
          label="Starting Vox"
          value={formatVox(credits)}
          delay={0.15}
        />
        <RewardRow
          icon={<Zap className="h-5 w-5" />}
          label="XP earned"
          value={xp.toLocaleString()}
          delay={0.25}
        />
        {recentBadges.length > 0 ? (
          <RewardRow
            icon={<Award className="h-5 w-5" />}
            label={recentBadges.length === 1 ? "Badge earned" : "Badges earned"}
            value={recentBadges
              .slice(0, 3)
              .map((b) => b.name)
              .join(", ") +
              (recentBadges.length > 3 ? ` +${recentBadges.length - 3}` : "")}
            delay={0.35}
          />
        ) : null}
      </div>

      <div className="mt-auto pt-10">
        <Button
          onClick={finish}
          className="w-full"
          size="lg"
          data-testid="completion-cta"
        >
          Start VoxMaxxing
        </Button>
      </div>
    </div>
  );
}

/** Animated halo of sparkles behind the welcome message. */
function RewardHalo() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex h-20 w-20 items-center justify-center"
    >
      {/* Concentric pulse — keeps the eye on the centre while the
          rewards fade in below. Pure CSS animation; no per-frame JS. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-primary/30 blur-2xl animate-pulse"
      />
      <span
        aria-hidden="true"
        className="absolute inset-2 rounded-full bg-primary/20 blur-xl"
      />
      <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/40">
        <Sparkles className="h-7 w-7 text-primary" strokeWidth={1.6} />
      </span>
    </motion.div>
  );
}

interface RewardRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  delay: number;
}

function RewardRow({ icon, label, value, delay }: RewardRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay }}
      className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 px-5 py-4"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-lg font-semibold text-foreground">
          {value}
        </p>
      </div>
    </motion.div>
  );
}
