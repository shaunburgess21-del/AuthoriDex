import type { ComponentType, SVGProps } from "react";
import {
  Swords,
  TrendingUp,
  TrendingDown,
  Star,
  BarChart3,
  MessageCircle,
  ImageIcon,
  UserPlus,
  Eye,
  EyeOff,
  Vote,
  Minus,
  ChevronUp,
  ChevronDown,
  ThumbsUp,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PersonAvatar } from "@/components/PersonAvatar";
import { cn } from "@/lib/utils";

export interface MyVoteCardData {
  id: string;
  voteType: string;
  value: number;
  targetName: string;
  detail: string | null;
  createdAt: string;
  hidden?: boolean;
  /** Optional: person identity for avatar rendering. Populated by /api/me/votes. */
  subjectId?: string | null;
  subjectAvatar?: string | null;
  subjectImageSlug?: string | null;
  /** Optional: whether the user's pick matched the community majority. */
  alignedWithMajority?: boolean | null;
}

interface MyVoteCardProps {
  vote: MyVoteCardData;
  /** When the profile is private, we dim the card and show a lock-style indicator instead of the eye toggle. */
  profileIsPrivate?: boolean;
  /** Called when the user toggles visibility on this item. Disabled when absent. */
  onToggleVisibility?: (vote: MyVoteCardData, nextHidden: boolean) => void;
  /** Optional disabled state during mutation */
  isPending?: boolean;
}

type VoteStyle = {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  gradient: string;
  accent: string;
  /** Background class for the 2px left accent bar (per-type identity marker). */
  accentBar: string;
};

const VOTE_STYLES: Record<string, VoteStyle> = {
  face_off: {
    label: "Matchup",
    icon: Swords,
    gradient: "from-purple-500/25 via-purple-500/10 to-transparent",
    accent: "text-purple-600 dark:text-purple-400",
    accentBar: "bg-purple-500/70",
  },
  sentiment: {
    label: "Sentiment",
    icon: TrendingUp,
    gradient: "from-cyan-500/25 via-cyan-500/10 to-transparent",
    accent: "text-cyan-600 dark:text-cyan-400",
    accentBar: "bg-cyan-500/70",
  },
  value_vote: {
    label: "Underrated/Overrated",
    icon: Star,
    gradient: "from-amber-500/25 via-amber-500/10 to-transparent",
    accent: "text-amber-600 dark:text-amber-400",
    accentBar: "bg-amber-500/70",
  },
  trending_poll: {
    label: "Poll",
    icon: BarChart3,
    gradient: "from-blue-500/25 via-blue-500/10 to-transparent",
    accent: "text-blue-600 dark:text-blue-400",
    accentBar: "bg-blue-500/70",
  },
  opinion_poll: {
    label: "Opinion",
    icon: MessageCircle,
    gradient: "from-sky-500/25 via-sky-500/10 to-transparent",
    accent: "text-sky-600 dark:text-sky-400",
    accentBar: "bg-sky-500/70",
  },
  image_curate: {
    label: "Curation",
    icon: ImageIcon,
    gradient: "from-pink-500/25 via-pink-500/10 to-transparent",
    accent: "text-pink-600 dark:text-pink-400",
    accentBar: "bg-pink-500/70",
  },
  induction: {
    label: "Induction",
    icon: UserPlus,
    gradient: "from-emerald-500/25 via-emerald-500/10 to-transparent",
    accent: "text-emerald-600 dark:text-emerald-400",
    accentBar: "bg-emerald-500/70",
  },
  overall_rating: {
    label: "Rating",
    icon: ThumbsUp,
    gradient: "from-cyan-500/25 via-cyan-500/10 to-transparent",
    accent: "text-cyan-600 dark:text-cyan-400",
    accentBar: "bg-cyan-500/70",
  },
};

// Matches SEGMENT_COLORS in AnimatedSentimentVotingWidget so the rating card feels
// continuous with the Overall Rating widget on the person page.
const RATING_ZONE_COLORS = ["#FF0000", "#FF6D00", "#FFC400", "#76FF03", "#00C853"];
const RATING_ZONE_LABELS = ["Hate", "Dislike", "Neutral", "Like", "Love"];

function RatingSpectrum({ rating }: { rating: number }) {
  const clamped = Math.max(1, Math.min(5, Math.round(rating)));
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n === clamped;
        const color = RATING_ZONE_COLORS[n - 1];
        return (
          <span
            key={n}
            className={cn(
              "relative inline-flex h-2.5 w-6 rounded-full transition-all",
              active ? "h-3 ring-2 ring-offset-1 ring-offset-background" : "opacity-50",
            )}
            style={{
              backgroundColor: color,
              boxShadow: active ? `0 0 10px ${color}` : undefined,
              // @ts-expect-error ring color
              "--tw-ring-color": color,
            }}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

function getStyle(voteType: string): VoteStyle {
  return (
    VOTE_STYLES[voteType] ?? {
      label: voteType,
      icon: Vote,
      gradient: "from-slate-500/20 via-slate-500/5 to-transparent",
      accent: "text-muted-foreground",
      accentBar: "bg-slate-500/60",
    }
  );
}

// The coloured chip that summarises the user's actual pick / stance.
function PickChip({ vote }: { vote: MyVoteCardData }) {
  const { voteType, value, detail } = vote;

  // Up/Down stances get the strongest colour treatment.
  if (voteType === "sentiment" || voteType === "value_vote") {
    if (value > 0) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30 gap-1">
          <ChevronUp className="h-3 w-3" /> {detail ?? "Underrated"}
        </Badge>
      );
    }
    if (value < 0) {
      return (
        <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30 gap-1">
          <ChevronDown className="h-3 w-3" /> {detail ?? "Overrated"}
        </Badge>
      );
    }
    return (
      <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30 gap-1">
        <Minus className="h-3 w-3" /> {detail ?? "Fairly Rated"}
      </Badge>
    );
  }

  if (voteType === "trending_poll") {
    if (value > 0) {
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30 gap-1">
          <TrendingUp className="h-3 w-3" /> {detail ?? "Support"}
        </Badge>
      );
    }
    if (value < 0) {
      return (
        <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30 gap-1">
          <TrendingDown className="h-3 w-3" /> {detail ?? "Oppose"}
        </Badge>
      );
    }
    return (
      <Badge className="bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30 gap-1">
        <Minus className="h-3 w-3" /> {detail ?? "Neutral"}
      </Badge>
    );
  }

  if (voteType === "image_curate") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30 gap-1">
        <ChevronUp className="h-3 w-3" /> Upvote
      </Badge>
    );
  }

  if (voteType === "overall_rating") {
    const rating = Math.max(1, Math.min(5, Math.round(value || 0)));
    const zoneLabel = RATING_ZONE_LABELS[rating - 1];
    const zoneColor = RATING_ZONE_COLORS[rating - 1];
    return (
      <div className="flex flex-wrap items-center gap-2">
        <RatingSpectrum rating={rating} />
        <span
          className="text-xs font-semibold tabular-nums"
          style={{ color: zoneColor }}
        >
          {rating}/5 - {zoneLabel}
        </span>
      </div>
    );
  }

  if (detail) {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        {detail}
      </Badge>
    );
  }

  return null;
}

// Which vote types carry a real subject/person we can show a photo for.
const PERSON_VOTE_TYPES = new Set([
  "sentiment",
  "value_vote",
  "image_curate",
  "induction",
  "overall_rating",
]);

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MyVoteCard({
  vote,
  profileIsPrivate = false,
  onToggleVisibility,
  isPending = false,
}: MyVoteCardProps) {
  const style = getStyle(vote.voteType);
  const Icon = style.icon;
  const hidden = vote.hidden === true;
  const effectivelyPublic = !profileIsPrivate && !hidden;

  const toggleLabel = hidden
    ? "Hidden from your public profile. Click to make visible."
    : profileIsPrivate
      ? "Your profile is private. This would be hidden from others."
      : "Visible on your public profile. Click to hide.";

  return (
    <Card
      className={cn(
        "group relative overflow-hidden border-white/5 bg-card/60 backdrop-blur-sm",
        "transition-all duration-150",
        !hidden && "hover:border-white/10 hover:-translate-y-0.5 hover:shadow-md",
      )}
      data-testid={`my-vote-card-${vote.id}`}
      data-vote-hidden={hidden ? "true" : "false"}
    >
      {/* Per-type left accent bar - instantly communicates vote type without reading the badge. */}
      <div
        className={cn("pointer-events-none absolute left-0 top-0 h-full w-0.5", style.accentBar)}
        aria-hidden
      />
      {/* Subtle vote-type gradient glow */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60",
          style.gradient,
          hidden && "opacity-20",
        )}
        aria-hidden
      />
      {/* Hidden state: faint diagonal stripe overlay so a grid of cards is scannable at a glance. */}
      {hidden && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent 0 6px, rgba(148,163,184,0.18) 6px 12px)",
          }}
        />
      )}

      <div
        className={cn(
          "relative flex gap-3 p-4 sm:p-5 transition-opacity",
          hidden && "opacity-60",
        )}
      >
        {/* Leading visual: real person photo for person-tied votes, icon chip otherwise. */}
        {PERSON_VOTE_TYPES.has(vote.voteType) && (vote.subjectAvatar || vote.subjectImageSlug) ? (
          <div className="relative shrink-0">
            <PersonAvatar
              name={vote.targetName}
              avatar={vote.subjectAvatar ?? undefined}
              imageSlug={vote.subjectImageSlug ?? undefined}
              className="h-11 w-11 shadow-sm"
            />
            <span
              className={cn(
                "absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-background bg-background shadow",
                style.accent,
              )}
              aria-hidden
            >
              <Icon className="h-3 w-3" />
            </span>
          </div>
        ) : (
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-background/60 shadow-sm backdrop-blur-sm",
              style.accent,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        )}

        {/* Body */}
        <div className="min-w-0 flex-1 pr-8">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
            {style.label}
          </p>
          <p className="mt-0.5 font-semibold leading-snug truncate" title={vote.targetName}>
            {vote.targetName || "Unknown"}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <PickChip vote={vote} />
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(vote.createdAt)}
            </span>
            {hidden && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-foreground/20 bg-background/60 text-[10px] font-normal text-muted-foreground"
              >
                <EyeOff className="h-3 w-3" /> Hidden
              </Badge>
            )}
            {!hidden && profileIsPrivate && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-foreground/20 bg-background/60 text-[10px] font-normal text-muted-foreground"
              >
                <EyeOff className="h-3 w-3" /> Profile private
              </Badge>
            )}
            {effectivelyPublic && onToggleVisibility && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] font-normal text-emerald-600 dark:text-emerald-300"
              >
                <Eye className="h-3 w-3" /> Public
              </Badge>
            )}
            {vote.alignedWithMajority === true && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-sky-500/30 bg-sky-500/10 text-[10px] font-normal text-sky-600 dark:text-sky-300"
                title="Your pick matched the crowd's majority"
              >
                Aligned
              </Badge>
            )}
            {vote.alignedWithMajority === false && (
              <Badge
                variant="outline"
                className="h-5 gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] font-normal text-violet-600 dark:text-violet-300"
                title="Your pick went against the crowd's majority"
              >
                Contrarian
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Visibility toggle sits outside the body wrapper so it stays crisp when the card
         is hidden (body fades to opacity-60). Hit target padded to >=44px for touch. */}
      {onToggleVisibility && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onToggleVisibility(vote, !hidden)}
              disabled={isPending}
              aria-pressed={hidden}
              aria-label={hidden ? "Make visible on public profile" : "Hide from public profile"}
              className={cn(
                "absolute right-1.5 top-1.5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md",
                "text-muted-foreground transition-opacity duration-150",
                "hover:bg-muted/60 hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:opacity-100",
                "disabled:cursor-not-allowed disabled:opacity-50",
                hidden
                  ? "opacity-100 text-foreground/80"
                  : "opacity-40 hover:opacity-100 group-hover:opacity-100",
              )}
              data-testid={`toggle-visibility-${vote.id}`}
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[220px] text-xs">
            {toggleLabel}
          </TooltipContent>
        </Tooltip>
      )}
    </Card>
  );
}
