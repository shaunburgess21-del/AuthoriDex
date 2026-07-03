import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, TrendingUp } from "lucide-react";
import type { AuthReason } from "@/lib/authReturn";
import { cn } from "@/lib/utils";
import {
  SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
  SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS,
} from "@/lib/sentimentPollVoteDisplay";

const HERO_HEIGHT = "h-[150px]";

const ACCENT: Record<
  AuthReason,
  {
    boxBorder: string;
    boxBg: string;
    ballot: string;
    shimmer: string;
    chip: string;
    line: string;
    fill: string;
  }
> = {
  vote_limit_reached: {
    boxBorder: "border-cyan-500/30",
    boxBg: "bg-cyan-500/10",
    ballot: "bg-cyan-400/80",
    shimmer: "via-cyan-400/25",
    chip: "bg-cyan-500",
    line: "stroke-cyan-500",
    fill: "fill-cyan-500/20",
  },
  predict_signup: {
    boxBorder: "border-violet-500/30",
    boxBg: "bg-violet-500/10",
    ballot: "bg-violet-400/80",
    shimmer: "via-violet-400/25",
    chip: "bg-violet-500",
    line: "stroke-violet-500",
    fill: "fill-violet-500/20",
  },
};

function CheckBadge() {
  return (
    <div
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full shadow-lg",
        SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
        SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS,
      )}
    >
      <Check className="h-4 w-4 text-white" strokeWidth={3} />
    </div>
  );
}

/** Static hero for Suspense fallback and reduced-motion users. */
export function SignupReasonHeroPlaceholder({ reason }: { reason: AuthReason }) {
  const accent = ACCENT[reason];

  return (
    <div
      className={cn(
        "relative flex items-center justify-center",
        HERO_HEIGHT,
      )}
      aria-hidden
    >
      {reason === "vote_limit_reached" ? (
        <div className="relative">
          <div
            className={cn(
              "relative h-20 w-24 overflow-hidden rounded-lg border",
              accent.boxBorder,
              accent.boxBg,
            )}
          >
            <div className="absolute inset-x-2 top-2 h-1.5 rounded-full bg-muted-foreground/20" />
            <div
              className={cn(
                "absolute inset-x-3 top-6 bottom-3 rounded-sm",
                accent.ballot,
              )}
            />
          </div>
          <div className="absolute -right-2 -top-2">
            <CheckBadge />
          </div>
        </div>
      ) : (
        <div className="relative w-28">
          <svg viewBox="0 0 112 64" className="h-16 w-full" aria-hidden>
            <path
              d="M8 52 L32 40 L56 44 L88 16 L104 24"
              fill="none"
              className={accent.line}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 52 L32 40 L56 44 L88 16 L104 24 L104 56 L8 56 Z"
              className={accent.fill}
            />
          </svg>
          <div
            className={cn(
              "absolute left-1/2 top-6 flex h-6 w-10 -translate-x-1/2 items-center justify-center rounded-md text-[10px] font-semibold text-white",
              accent.chip,
            )}
          >
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div className="absolute -right-1 -top-1">
            <CheckBadge />
          </div>
        </div>
      )}
    </div>
  );
}

function VoteBallotHero({ accent }: { accent: (typeof ACCENT)["vote_limit_reached"] }) {
  return (
    <div className="relative">
      <div
        className={cn(
          "relative h-20 w-24 overflow-hidden rounded-lg border",
          accent.boxBorder,
          accent.boxBg,
        )}
      >
        <div className="absolute inset-x-2 top-2 h-1.5 rounded-full bg-muted-foreground/20" />
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.15 }}
          className={cn(
            "absolute inset-x-3 top-6 bottom-3 rounded-sm",
            accent.ballot,
          )}
        />
        <motion.div
          initial={{ x: "-100%" }}
          animate={{ x: "200%" }}
          transition={{ duration: 0.55, ease: "easeInOut", delay: 0.55 }}
          className={cn(
            "pointer-events-none absolute inset-0 skew-x-12 bg-gradient-to-r from-transparent to-transparent",
            accent.shimmer,
          )}
        />
      </div>
      <motion.div
        className="absolute -right-2 -top-2"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          stiffness: 420,
          damping: 22,
          delay: 0.55,
        }}
      >
        <CheckBadge />
      </motion.div>
    </div>
  );
}

function PredictChartHero({ accent }: { accent: (typeof ACCENT)["predict_signup"] }) {
  return (
    <div className="relative w-28">
      <svg viewBox="0 0 112 64" className="h-16 w-full" aria-hidden>
        <motion.path
          d="M8 52 L32 40 L56 44 L88 16 L104 24"
          fill="none"
          className={accent.line}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}
        />
        <motion.path
          d="M8 52 L32 40 L56 44 L88 16 L104 24 L104 56 L8 56 Z"
          className={accent.fill}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, delay: 0.45 }}
        />
      </svg>
      <motion.div
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 24, delay: 0.35 }}
        className={cn(
          "absolute left-1/2 top-6 flex h-6 w-10 -translate-x-1/2 items-center justify-center rounded-md text-white shadow-md",
          accent.chip,
        )}
      >
        <TrendingUp className="h-3.5 w-3.5" />
      </motion.div>
      <motion.div
        className="absolute -right-1 -top-1"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          stiffness: 420,
          damping: 22,
          delay: 0.6,
        }}
      >
        <CheckBadge />
      </motion.div>
    </div>
  );
}

export function SignupReasonHero({ reason }: { reason: AuthReason }) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (reduceMotion) {
    return <SignupReasonHeroPlaceholder reason={reason} />;
  }

  const accent = ACCENT[reason];

  return (
    <div
      className={cn(
        "relative flex items-center justify-center",
        HERO_HEIGHT,
      )}
      aria-hidden
    >
      {reason === "vote_limit_reached" ? (
        <VoteBallotHero accent={accent} />
      ) : (
        <PredictChartHero accent={accent} />
      )}
    </div>
  );
}
