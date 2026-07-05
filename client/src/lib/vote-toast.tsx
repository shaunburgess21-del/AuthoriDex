import { toast, type ExternalToast } from "sonner";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Camera,
  Crown,
  ListChecks,
  MessageSquare,
  Scale,
  Swords,
  TrendingUp,
  Trophy,
  Vote,
} from "lucide-react";

/**
 * iOS-style vote/prediction toast with a leading icon chip that mirrors the
 * desktop section header for that vote type (UnifiedSectionHeader accents:
 * cyan for /vote sections, violet for /predict, amber for Weekly Jackpot).
 * The `vd-toast` class pairs with the icon-slot sizing rules in index.css.
 */
export type VoteToastKind =
  | "sentiment"
  | "matchup"
  | "opinion"
  | "overrated"
  | "induction"
  | "curate"
  | "updown"
  | "h2h"
  | "gainer"
  | "jackpot"
  | "world";

type Accent = "cyan" | "violet" | "amber";

const KIND_CONFIG: Record<VoteToastKind, { icon: LucideIcon; accent: Accent }> = {
  sentiment: { icon: MessageSquare, accent: "cyan" },
  matchup: { icon: Swords, accent: "cyan" },
  opinion: { icon: ListChecks, accent: "cyan" },
  overrated: { icon: BarChart3, accent: "cyan" },
  induction: { icon: Vote, accent: "cyan" },
  curate: { icon: Camera, accent: "cyan" },
  updown: { icon: TrendingUp, accent: "violet" },
  h2h: { icon: Swords, accent: "violet" },
  gainer: { icon: Trophy, accent: "violet" },
  jackpot: { icon: Crown, accent: "amber" },
  world: { icon: Scale, accent: "violet" },
};

const ACCENT_CLASSES: Record<Accent, { chip: string; icon: string }> = {
  cyan: {
    chip: "bg-cyan-500/15 dark:bg-cyan-500/10",
    icon: "text-cyan-600 dark:text-cyan-400",
  },
  violet: {
    chip: "bg-violet-500/15 dark:bg-violet-500/10",
    icon: "text-violet-600 dark:text-violet-400",
  },
  amber: {
    chip: "bg-amber-500/15 dark:bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-400",
  },
};

export function VoteToastChip({ kind }: { kind: VoteToastKind }) {
  const { icon: Icon, accent } = KIND_CONFIG[kind];
  const classes = ACCENT_CLASSES[accent];
  return (
    <div
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${classes.chip}`}
    >
      <Icon className={`h-[18px] w-[18px] ${classes.icon}`} aria-hidden="true" />
    </div>
  );
}

/** Map a prediction market's `marketType` to the matching toast kind. */
export function marketToastKind(
  marketType: string | null | undefined,
): VoteToastKind {
  switch (marketType) {
    case "updown":
      return "updown";
    case "h2h":
      return "h2h";
    case "gainer":
    case "race":
      return "gainer";
    case "jackpot":
      return "jackpot";
    default:
      return "world";
  }
}

export function showVoteToast(
  kind: VoteToastKind,
  title: string,
  options?: ExternalToast,
): string | number {
  return toast(title, {
    duration: 5000,
    ...options,
    icon: <VoteToastChip kind={kind} />,
    className: ["vd-toast", options?.className].filter(Boolean).join(" "),
  });
}

/** Fire an instant pending toast; returns the id for in-place update on success. */
export function showPendingVoteToast(
  kind: VoteToastKind,
  title: string,
  description?: string,
): string | number {
  const id = `vd-pending-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  showVoteToast(kind, title, { id, description });
  return id;
}

export function dismissVoteToast(id: string | number | undefined): void {
  if (id != null) toast.dismiss(id);
}
