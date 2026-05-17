/**
 * Canonical category → Lucide icon registry.
 *
 * Used by the onboarding / re-prompt InterestsPicker to render an icon
 * grid in the spirit of Reddit's interest selector. The mapping mirrors
 * the inline icon ladder in
 * [client/src/components/home/VoteDeckView.tsx](client/src/components/home/VoteDeckView.tsx)
 * so the same glyph represents the same category everywhere — Creator
 * is a video recorder, Film & TV is a clapperboard, etc. Misc inherits
 * Creator's icon (the canonical set never gave Misc its own glyph and
 * the video icon reads as a sensible "miscellaneous content" cue).
 *
 * Dynamic admin-added categories (Media & Podcast, Streaming, Science)
 * each get their own icon so they don't all collapse onto the fallback.
 * Anything still un-mapped falls back to `Video` for visual continuity
 * with Misc.
 */
import {
  Briefcase,
  Clapperboard,
  Cpu,
  Gamepad2,
  Heart,
  Landmark,
  Laugh,
  Mic,
  Microscope,
  Music2,
  Trophy,
  Tv,
  UtensilsCrossed,
  Video,
  type LucideIcon,
} from "lucide-react";

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
