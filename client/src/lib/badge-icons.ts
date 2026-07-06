import type { LucideIcon } from "lucide-react";
import {
  Award,
  BadgeCheck,
  Brain,
  Calendar,
  CalendarCheck,
  CalendarDays,
  CalendarHeart,
  Camera,
  CheckSquare,
  Crown,
  Eye,
  Flame,
  Gem,
  GraduationCap,
  Globe2,
  Heart,
  IdCard,
  Image as ImageIcon,
  Landmark,
  Lightbulb,
  LineChart,
  Medal,
  Megaphone,
  Network,
  PartyPopper,
  PenTool,
  Radio,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  TrendingUp,
  Trophy,
  User,
  UserPlus,
  Users,
  Vote,
} from "lucide-react";

/**
 * Resolves a kebab-case icon name from `shared/badge-config.ts` to
 * a Lucide React component. Keep this map in sync with the icon
 * field on each BADGES entry — adding a badge with a fresh icon
 * name needs the matching entry here. Missing names fall back to
 * `Award` so a typo never crashes the badge grid.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  award: Award,
  "badge-check": BadgeCheck,
  brain: Brain,
  calendar: Calendar,
  "calendar-check": CalendarCheck,
  "calendar-days": CalendarDays,
  "calendar-heart": CalendarHeart,
  camera: Camera,
  "check-square": CheckSquare,
  crown: Crown,
  eye: Eye,
  flame: Flame,
  gem: Gem,
  "graduation-cap": GraduationCap,
  "globe-2": Globe2,
  heart: Heart,
  "id-card": IdCard,
  image: ImageIcon,
  landmark: Landmark,
  lightbulb: Lightbulb,
  "line-chart": LineChart,
  medal: Medal,
  megaphone: Megaphone,
  network: Network,
  "party-popper": PartyPopper,
  "pen-tool": PenTool,
  radio: Radio,
  "share-2": Share2,
  "shield-check": ShieldCheck,
  sparkles: Sparkles,
  star: Star,
  target: Target,
  "thumbs-up": ThumbsUp,
  "trending-up": TrendingUp,
  trophy: Trophy,
  user: User,
  "user-plus": UserPlus,
  users: Users,
  vote: Vote,
};

export function getBadgeIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Award;
}

/** Tailwind tokens per rarity. Used by BadgeCard + BadgeToast. */
export const RARITY_STYLES: Record<
  string,
  {
    /** Border + ring tint for the earned card. */
    border: string;
    /** Subtle bg tint for the icon disk + earned card surface. */
    bgSoft: string;
    /** Foreground accent for the icon and rarity chip text. */
    accent: string;
    /** Rarity chip outline. */
    chipBorder: string;
    /** Display label. */
    label: string;
  }
> = {
  COMMON: {
    border: "border-slate-400/40 dark:border-slate-500/40",
    bgSoft: "bg-slate-500/10",
    accent: "text-slate-700 dark:text-slate-200",
    chipBorder: "border-slate-500/40",
    label: "Common",
  },
  RARE: {
    border: "border-blue-400/50 dark:border-blue-500/50",
    bgSoft: "bg-blue-500/10",
    accent: "text-blue-600 dark:text-blue-300",
    chipBorder: "border-blue-500/40",
    label: "Rare",
  },
  EPIC: {
    border: "border-purple-400/50 dark:border-purple-500/50",
    bgSoft: "bg-purple-500/10",
    accent: "text-purple-600 dark:text-purple-300",
    chipBorder: "border-purple-500/40",
    label: "Epic",
  },
  LEGENDARY: {
    border: "border-amber-400/60 dark:border-amber-500/60",
    bgSoft: "bg-amber-500/10",
    accent: "text-amber-600 dark:text-amber-300",
    chipBorder: "border-amber-500/50",
    label: "Legendary",
  },
};

export function getRarityStyle(rarity: string) {
  return RARITY_STYLES[rarity] ?? RARITY_STYLES.COMMON;
}

/** Hex accent colours for earned-glow CSS (--glow-color). */
export const RARITY_GLOW_COLORS: Record<string, string> = {
  COMMON: "#94A3B8",
  RARE: "#3C83F6",
  EPIC: "#8B5CF6",
  LEGENDARY: "#F59E0B",
};

export function getRarityGlowColor(rarity: string): string {
  return RARITY_GLOW_COLORS[rarity] ?? RARITY_GLOW_COLORS.COMMON;
}

export const CATEGORY_LABELS: Record<string, string> = {
  VOTING: "Voting",
  PREDICTION: "Prediction",
  CONTENT: "Content",
  STREAK: "Streak",
  SOCIAL: "Social",
  PROFILE: "Profile",
  SPECIAL: "Special",
};
