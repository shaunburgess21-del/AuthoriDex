import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRightLeft, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
  SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS,
} from "@/lib/sentimentPollVoteDisplay";

const HERO_HEIGHT = "h-[150px]";

function truncateLabel(name: string, max = 14): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

function CheckBadge() {
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full shadow-lg",
        SENTIMENT_POLL_SUPPORT_BADGE_BG_CLASS,
        SENTIMENT_POLL_SUPPORT_BADGE_SHADOW_CLASS,
      )}
    >
      <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
    </div>
  );
}

interface ChangeVoteHeroProps {
  fromOptionName?: string;
  toOptionName: string;
}

function VoteChip({
  label,
  variant,
  className,
}: {
  label: string;
  variant: "from" | "to";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-10 max-w-[96px] items-center justify-center rounded-lg border px-2 text-center text-[11px] font-medium leading-tight",
        variant === "from"
          ? "border-border/60 bg-muted/40 text-muted-foreground"
          : "border-cyan-500/40 bg-cyan-500/15 text-foreground",
        className,
      )}
    >
      <span className="truncate">{truncateLabel(label)}</span>
    </div>
  );
}

/** Static hero for Suspense fallback and reduced-motion users. */
export function ChangeVoteHeroPlaceholder({
  fromOptionName,
  toOptionName,
}: ChangeVoteHeroProps) {
  const fromLabel = fromOptionName ?? "Your vote";

  return (
    <div
      className={cn("relative flex items-center justify-center", HERO_HEIGHT)}
      aria-hidden
    >
      <div className="flex items-center gap-2">
        <VoteChip label={fromLabel} variant="from" />
        <ArrowRightLeft className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
        <div className="relative">
          <VoteChip label={toOptionName} variant="to" />
          <div className="absolute -right-2 -top-2">
            <CheckBadge />
          </div>
        </div>
      </div>
    </div>
  );
}

function AnimatedSwapHero({
  fromOptionName,
  toOptionName,
}: ChangeVoteHeroProps) {
  const fromLabel = fromOptionName ?? "Your vote";

  return (
    <div className="flex items-center gap-2">
      <motion.div
        initial={{ opacity: 1, x: 0 }}
        animate={{ opacity: 0.45, x: -6 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
      >
        <VoteChip label={fromLabel} variant="from" />
      </motion.div>

      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          type: "spring",
          stiffness: 420,
          damping: 22,
          delay: 0.25,
        }}
      >
        <ArrowRightLeft className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
      </motion.div>

      <motion.div
        className="relative"
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: "easeOut", delay: 0.35 }}
      >
        <VoteChip label={toOptionName} variant="to" />
        <motion.div
          className="absolute -right-2 -top-2"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 22,
            delay: 0.65,
          }}
        >
          <CheckBadge />
        </motion.div>
      </motion.div>
    </div>
  );
}

export function ChangeVoteHero({
  fromOptionName,
  toOptionName,
}: ChangeVoteHeroProps) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (reduceMotion) {
    return (
      <ChangeVoteHeroPlaceholder
        fromOptionName={fromOptionName}
        toOptionName={toOptionName}
      />
    );
  }

  return (
    <div
      className={cn("relative flex items-center justify-center", HERO_HEIGHT)}
      aria-hidden
    >
      <AnimatedSwapHero
        fromOptionName={fromOptionName}
        toOptionName={toOptionName}
      />
    </div>
  );
}
