import { useEffect, useState, type SyntheticEvent } from "react";
import { handleImageError } from "@/lib/imageResolver";
import { coalesceHttpImage } from "@/lib/displayImageUrl";
import { cn } from "@/lib/utils";

export type ThumbParticipant = {
  name: string;
  avatar?: string | null;
  /** Tried via `handleImageError` when `avatar` fails (e.g. matchup bucket fallbacks). */
  avatarFallback?: string | null;
};

export type MarketThumbCollageSize = "sm" | "lg";

export type MarketThumbCollageProps = {
  variant: "single" | "split" | "grid";
  participants: ThumbParticipant[];
  /** `lg` for related-market cards; `sm` keeps the original compact footprint. */
  size?: MarketThumbCollageSize;
  /** Vote matchups use amber on the right; predict markets use purple. */
  splitAccent?: "predict" | "vote";
  className?: string;
};

const DIMENSIONS: Record<
  MarketThumbCollageSize,
  { single: string; split: string; grid: string; initial: string; vs: string }
> = {
  sm: {
    single: "h-10 w-10",
    split: "h-10 w-10",
    grid: "h-10 w-10",
    initial: "text-[9px]",
    vs: "text-[7px] px-1",
  },
  lg: {
    single: "h-16 w-16",
    split: "h-[4.5rem] w-[7.5rem]",
    grid: "h-16 w-16",
    initial: "text-xs",
    vs: "text-[9px] px-1.5",
  },
};

function participantInitial(name: string): string {
  return (name.trim().charAt(0) || "?").toUpperCase();
}

function ThumbCell({
  name,
  avatar,
  avatarFallback,
  className,
  initialClassName,
}: {
  name: string;
  avatar?: string | null;
  avatarFallback?: string | null;
  className?: string;
  initialClassName?: string;
}) {
  const primary = coalesceHttpImage(avatar);
  const fallback = coalesceHttpImage(avatarFallback);
  const fallbackDistinct =
    fallback && fallback !== primary ? fallback : null;
  const [showInitials, setShowInitials] = useState(!primary && !fallbackDistinct);

  useEffect(() => {
    setShowInitials(!primary && !fallbackDistinct);
  }, [primary, fallbackDistinct]);

  if (showInitials) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-muted/50 font-semibold text-muted-foreground",
          initialClassName,
          className,
        )}
        aria-hidden
      >
        {participantInitial(name)}
      </div>
    );
  }

  const onImgError = (e: SyntheticEvent<HTMLImageElement>) => {
    handleImageError(e, fallbackDistinct);
    if (e.currentTarget.style.display === "none") {
      setShowInitials(true);
    }
  };

  return (
    <img
      src={primary ?? fallbackDistinct ?? undefined}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
      onError={onImgError}
    />
  );
}

export function MarketThumbCollage({
  variant,
  participants,
  size = "sm",
  splitAccent = "predict",
  className,
}: MarketThumbCollageProps) {
  const dim = DIMENSIONS[size];

  if (variant === "single" || participants.length <= 1) {
    const p = participants[0] ?? { name: "?", avatar: null };
    return (
      <div className={cn(dim.single, "shrink-0", className)}>
        <ThumbCell
          name={p.name}
          avatar={p.avatar}
          avatarFallback={p.avatarFallback}
          className="rounded-lg"
          initialClassName={dim.initial}
        />
      </div>
    );
  }

  if (variant === "split") {
    const left = participants[0] ?? { name: "?", avatar: null };
    const right = participants[1] ?? { name: "?", avatar: null };
    const rightBg =
      splitAccent === "vote" ? "bg-amber-600/20" : "bg-purple-600/20";
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl ring-1 ring-border/40",
          dim.split,
          className,
        )}
        aria-label={`${left.name} vs ${right.name}`}
      >
        <div className="absolute inset-0 flex">
          <div className="relative h-full w-1/2 overflow-hidden bg-blue-600/20">
            <ThumbCell
              name={left.name}
              avatar={left.avatar}
              avatarFallback={left.avatarFallback}
              initialClassName={dim.initial}
            />
          </div>
          <div className={cn("relative h-full w-1/2 overflow-hidden", rightBg)}>
            <ThumbCell
              name={right.name}
              avatar={right.avatar}
              avatarFallback={right.avatarFallback}
              initialClassName={dim.initial}
            />
          </div>
        </div>
        <span
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/60 bg-background/95 py-0.5 font-bold uppercase tracking-wide text-muted-foreground shadow-sm",
            dim.vs,
          )}
          aria-hidden
        >
          vs
        </span>
      </div>
    );
  }

  const cells = participants.slice(0, 4);

  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-2 grid-rows-2 overflow-hidden rounded-xl ring-1 ring-border/40",
        dim.grid,
        className,
      )}
      aria-label={cells.map((c) => c.name).join(", ")}
    >
      {cells.map((p, i) => (
        <div key={`${p.name}-${i}`} className="relative overflow-hidden">
          <ThumbCell
            name={p.name}
            avatar={p.avatar}
            avatarFallback={p.avatarFallback}
            initialClassName={dim.initial}
          />
        </div>
      ))}
    </div>
  );
}
