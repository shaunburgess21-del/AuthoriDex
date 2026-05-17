/**
 * Canonical category → Lucide icon registry.
 *
 * Used by the onboarding / re-prompt InterestsPicker to render an icon
 * grid in the spirit of Reddit's interest selector. Kept as a single
 * source of truth so any other surface that needs a category icon
 * (badges, leaderboards, marketing) can reuse the same mapping
 * instead of re-picking icons ad-hoc.
 *
 * Dynamic categories from the registry that aren't in this map fall
 * back to `Layers` (the same icon used for `misc`) — visually neutral,
 * never blocks rendering.
 */
import {
  Briefcase,
  Cpu,
  Film,
  Gamepad2,
  Heart,
  Landmark,
  Layers,
  Music2,
  Smile,
  Sparkles,
  Trophy,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  tech: Cpu,
  politics: Landmark,
  business: Briefcase,
  music: Music2,
  sports: Trophy,
  "film-tv": Film,
  gaming: Gamepad2,
  creator: Sparkles,
  comedy: Smile,
  "food-drink": UtensilsCrossed,
  lifestyle: Heart,
  misc: Layers,
};

export function getCategoryIcon(id: string): LucideIcon {
  return CATEGORY_ICONS[id] ?? Layers;
}
