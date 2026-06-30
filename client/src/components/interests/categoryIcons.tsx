/**
 * Canonical category → Lucide icon registry.
 *
 * Used by the onboarding / re-prompt InterestsPicker to render an icon
 * grid in the spirit of Reddit's interest selector. The mapping is the
 * canonical source of truth for category → glyph everywhere in the app
 * — Creator is a video recorder, Film & TV is a clapperboard, etc.
 * Misc inherits Creator's icon (the canonical set never gave Misc its
 * own glyph and the video icon reads as a sensible "miscellaneous
 * content" cue).
 *
 * Dynamic admin-added categories (Media & Podcast, Streaming, Science)
 * each get their own icon so they don't all collapse onto the fallback.
 * Anything still un-mapped falls back to `Video` for visual continuity
 * with Misc.
 */
import {
  Bitcoin,
  BrainCircuit,
  Briefcase,
  Clapperboard,
  Cpu,
  Flame,
  Gamepad2,
  Heart,
  HeartHandshake,
  HeartPulse,
  Landmark,
  Laugh,
  LayoutGrid,
  Mic,
  Microscope,
  Music2,
  Plane,
  Shirt,
  Sparkles,
  Star,
  Trophy,
  Tv,
  UtensilsCrossed,
  Video,
  type LucideIcon,
} from "lucide-react";
import { normalizeMarketCategory } from "@shared/constants";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  tech: Cpu,
  politics: Landmark,
  business: Briefcase,
  music: Music2,
  sports: Trophy,
  "film-tv": Clapperboard,
  gaming: Gamepad2,
  creator: Video,
  comedy: Laugh,
  "food-drink": UtensilsCrossed,
  lifestyle: Heart,
  crypto: Bitcoin,
  ai: BrainCircuit,
  fashion: Shirt,
  beauty: Sparkles,
  health: HeartPulse,
  travel: Plane,
  dating: HeartHandshake,
  misc: Video,
  // Dynamic categories registered through the admin CMS. The
  // `media-podcast` alias is defensive — depending on how the row was
  // created, the registry id may be either `media` (matches
  // EXTRA_CATEGORY_STYLES in CategoryPill.tsx) or the slugified label.
  media: Mic,
  "media-podcast": Mic,
  streaming: Tv,
  science: Microscope,
};

export function getCategoryIcon(id: string): LucideIcon {
  return CATEGORY_ICONS[id] ?? Video;
}

/**
 * UI-only filter pins shared across filter bars (Vote / Predict / overlays).
 * Kept separate from CATEGORY_ICONS so they can't leak into category payloads.
 */
export const FILTER_PIN_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  favorites: Star,
  trending: Flame,
};

/**
 * Icon for any filter value: the UI pins (all/favorites/trending) or a category.
 * Normalizes the input so both kebab ids and Title Case labels resolve to the
 * single canonical glyph registry.
 */
export function getFilterCategoryIcon(raw: string): LucideIcon {
  if (raw in FILTER_PIN_ICONS) return FILTER_PIN_ICONS[raw]!;
  return getCategoryIcon(normalizeMarketCategory(raw));
}
