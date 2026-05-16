import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABELS,
  getBadgeIcon,
  getRarityStyle,
} from "@/lib/badge-icons";

export interface BadgeCardData {
  key: string;
  name: string;
  description: string;
  category: string;
  rarity: string;
  icon: string;
  sortOrder?: number;
  visibleOnFrontend?: boolean;
  earned: boolean;
  earnedAt: string | null;
  metadata?: Record<string, unknown> | null;
}

interface BadgeCardProps {
  badge: BadgeCardData;
  size?: "sm" | "md" | "lg";
  showCategory?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  sm: {
    container: "p-3",
    iconWrap: "h-9 w-9",
    icon: "h-4 w-4",
    name: "text-sm font-semibold",
    description: "text-[11px]",
    chip: "text-[9px] px-1.5 py-0",
    earnedChip: "text-[9px] px-1.5 py-0.5",
  },
  md: {
    container: "p-4",
    iconWrap: "h-12 w-12",
    icon: "h-6 w-6",
    name: "text-[15px] font-semibold",
    description: "text-xs",
    chip: "text-[10px] px-2 py-0.5",
    earnedChip: "text-[10px] px-2 py-0.5",
  },
  lg: {
    container: "p-5",
    iconWrap: "h-14 w-14",
    icon: "h-7 w-7",
    name: "text-base font-semibold",
    description: "text-sm",
    chip: "text-xs px-2.5 py-0.5",
    earnedChip: "text-xs px-2.5 py-0.5",
  },
};

/**
 * Universal badge card — used on /me/badges, /me/votes Impact tab,
 * and the public profile badges strip. Rendering rules:
 *
 *   - Earned: full-colour rarity-tinted border, icon prominent,
 *     "Earned" chip with the awarded date.
 *   - Locked: greyed out, lock icon overlay, name + description
 *     visible (so users know what to chase) but no earned date.
 *
 * Rarity colours come from `lib/badge-icons.ts:RARITY_STYLES` so
 * BadgeToast can reuse the same palette.
 */
export function BadgeCard({
  badge,
  size = "md",
  showCategory = false,
  className,
}: BadgeCardProps) {
  const Icon = getBadgeIcon(badge.icon);
  const rarity = getRarityStyle(badge.rarity);
  const sz = SIZE_CLASSES[size];
  const earnedAtLabel =
    badge.earned && badge.earnedAt
      ? new Date(badge.earnedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card transition-colors",
        sz.container,
        badge.earned
          ? cn(rarity.border, "shadow-sm")
          : "border-white/5 opacity-60 grayscale",
        className,
      )}
      data-testid={`badge-card-${badge.key}`}
      data-earned={badge.earned ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "shrink-0 rounded-full inline-flex items-center justify-center",
            sz.iconWrap,
            badge.earned ? rarity.bgSoft : "bg-muted",
          )}
        >
          {badge.earned ? (
            <Icon className={cn(sz.icon, rarity.accent)} />
          ) : (
            <Lock className={cn(sz.icon, "text-muted-foreground")} />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(sz.name, "leading-tight truncate")}
              title={badge.name}
            >
              {badge.name}
            </span>
            <span
              className={cn(
                "uppercase tracking-wide rounded-full border bg-background/40 font-semibold",
                sz.chip,
                rarity.chipBorder,
                rarity.accent,
              )}
            >
              {rarity.label}
            </span>
            {showCategory && (
              <span
                className={cn(
                  "rounded-full border border-white/10 text-muted-foreground bg-background/40",
                  sz.chip,
                )}
              >
                {CATEGORY_LABELS[badge.category] ?? badge.category}
              </span>
            )}
          </div>
          <p className={cn(sz.description, "text-muted-foreground leading-snug")}>
            {badge.description}
          </p>
          {badge.earned && earnedAtLabel && (
            <div className="pt-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 font-medium",
                  sz.earnedChip,
                )}
              >
                <Check className="h-3 w-3" /> Earned · {earnedAtLabel}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
