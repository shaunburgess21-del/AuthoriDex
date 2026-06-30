import { getMarketCategoryLabel, normalizeMarketCategory, type CanonicalMarketCategory } from "@shared/constants";

const CATEGORY_STYLES: Record<CanonicalMarketCategory, { bg: string; border: string; text: string }> = {
  tech: {
    bg: 'bg-[#1E90FF]/10',
    border: 'border-[#1E90FF]/40',
    text: 'text-[#1E90FF]',
  },
  music: {
    bg: 'bg-[#EC4899]/10',
    border: 'border-[#EC4899]/40',
    text: 'text-[#EC4899]',
  },
  politics: {
    bg: 'bg-[#94A3B8]/10',
    border: 'border-[#94A3B8]/40',
    text: 'text-[#94A3B8]',
  },
  business: {
    bg: 'bg-[#38BDF8]/10',
    border: 'border-[#38BDF8]/40',
    text: 'text-[#38BDF8]',
  },
  sports: {
    bg: 'bg-[#FB923C]/10',
    border: 'border-[#FB923C]/40',
    text: 'text-[#FB923C]',
  },
  "film-tv": {
    bg: 'bg-[#A855F7]/10',
    border: 'border-[#A855F7]/40',
    text: 'text-[#A855F7]',
  },
  gaming: {
    bg: 'bg-[#7C3AED]/10',
    border: 'border-[#7C3AED]/40',
    text: 'text-[#7C3AED]',
  },
  creator: {
    bg: 'bg-[#FACC15]/10',
    border: 'border-[#FACC15]/40',
    text: 'text-[#FACC15]',
  },
  comedy: {
    bg: 'bg-[#F97316]/10',
    border: 'border-[#F97316]/40',
    text: 'text-[#F97316]',
  },
  "food-drink": {
    bg: 'bg-[#D97706]/10',
    border: 'border-[#D97706]/40',
    text: 'text-[#D97706]',
  },
  lifestyle: {
    bg: 'bg-[#DB2777]/10',
    border: 'border-[#DB2777]/40',
    text: 'text-[#DB2777]',
  },
  crypto: {
    bg: 'bg-[#F59E0B]/10',
    border: 'border-[#F59E0B]/40',
    text: 'text-[#F59E0B]',
  },
  ai: {
    bg: 'bg-[#6366F1]/10',
    border: 'border-[#6366F1]/40',
    text: 'text-[#6366F1]',
  },
  fashion: {
    bg: 'bg-[#D946EF]/10',
    border: 'border-[#D946EF]/40',
    text: 'text-[#D946EF]',
  },
  beauty: {
    bg: 'bg-[#FB7185]/10',
    border: 'border-[#FB7185]/40',
    text: 'text-[#FB7185]',
  },
  health: {
    bg: 'bg-[#22C55E]/10',
    border: 'border-[#22C55E]/40',
    text: 'text-[#22C55E]',
  },
  travel: {
    bg: 'bg-[#06B6D4]/10',
    border: 'border-[#06B6D4]/40',
    text: 'text-[#06B6D4]',
  },
  dating: {
    bg: 'bg-[#EF4444]/10',
    border: 'border-[#EF4444]/40',
    text: 'text-[#EF4444]',
  },
  misc: {
    bg: 'bg-[#94A3B8]/10',
    border: 'border-[#94A3B8]/40',
    text: 'text-[#94A3B8]',
  },
};

// Palette for dynamically added categories (e.g. via admin category registry).
// Keep these distinct from canonical category colors so new categories don't
// visually collapse into existing ones.
const DYNAMIC_CATEGORY_STYLES: Array<{ bg: string; border: string; text: string }> = [
  { bg: "bg-[#22D3EE]/10", border: "border-[#22D3EE]/40", text: "text-[#22D3EE]" }, // cyan
  { bg: "bg-[#14B8A6]/10", border: "border-[#14B8A6]/40", text: "text-[#14B8A6]" }, // teal
  { bg: "bg-[#10B981]/10", border: "border-[#10B981]/40", text: "text-[#10B981]" }, // emerald
  { bg: "bg-[#84CC16]/10", border: "border-[#84CC16]/40", text: "text-[#84CC16]" }, // lime
  { bg: "bg-[#EAB308]/10", border: "border-[#EAB308]/40", text: "text-[#EAB308]" }, // yellow
  { bg: "bg-[#F59E0B]/10", border: "border-[#F59E0B]/40", text: "text-[#F59E0B]" }, // amber
  { bg: "bg-[#FB7185]/10", border: "border-[#FB7185]/40", text: "text-[#FB7185]" }, // rose
  { bg: "bg-[#F43F5E]/10", border: "border-[#F43F5E]/40", text: "text-[#F43F5E]" }, // pink-red
  { bg: "bg-[#E879F9]/10", border: "border-[#E879F9]/40", text: "text-[#E879F9]" }, // fuchsia
  { bg: "bg-[#C084FC]/10", border: "border-[#C084FC]/40", text: "text-[#C084FC]" }, // purple-light
  { bg: "bg-[#A78BFA]/10", border: "border-[#A78BFA]/40", text: "text-[#A78BFA]" }, // violet-light
  { bg: "bg-[#818CF8]/10", border: "border-[#818CF8]/40", text: "text-[#818CF8]" }, // indigo-light
  { bg: "bg-[#38BDF8]/10", border: "border-[#38BDF8]/40", text: "text-[#38BDF8]" }, // sky
  { bg: "bg-[#2DD4BF]/10", border: "border-[#2DD4BF]/40", text: "text-[#2DD4BF]" }, // teal-light
  { bg: "bg-[#4ADE80]/10", border: "border-[#4ADE80]/40", text: "text-[#4ADE80]" }, // green-light
  { bg: "bg-[#FBBF24]/10", border: "border-[#FBBF24]/40", text: "text-[#FBBF24]" }, // amber-light
];

const DEFAULT_CATEGORY_STYLE = {
  bg: 'bg-[#94A3B8]/10',
  border: 'border-[#94A3B8]/40',
  text: 'text-[#94A3B8]',
};

const CATEGORY_HEX: Record<CanonicalMarketCategory, string> = {
  tech: "#1E90FF",
  music: "#EC4899",
  politics: "#94A3B8",
  business: "#38BDF8",
  sports: "#FB923C",
  "film-tv": "#A855F7",
  gaming: "#7C3AED",
  creator: "#FACC15",
  comedy: "#F97316",
  "food-drink": "#D97706",
  lifestyle: "#DB2777",
  crypto: "#F59E0B",
  ai: "#6366F1",
  fashion: "#D946EF",
  beauty: "#FB7185",
  health: "#22C55E",
  travel: "#06B6D4",
  dating: "#EF4444",
  misc: "#94A3B8",
};

const EXTRA_CATEGORY_HEX: Record<string, string> = {
  media: "#10B981",
  streaming: "#4ADE80",
};

const DYNAMIC_CATEGORY_HEX = [
  "#22D3EE", "#14B8A6", "#10B981", "#84CC16", "#EAB308", "#F59E0B",
  "#FB7185", "#F43F5E", "#E879F9", "#C084FC", "#A78BFA", "#818CF8",
  "#38BDF8", "#2DD4BF", "#4ADE80", "#FBBF24",
] as const;

// Named overrides for non-canonical categories that should have stable, explicit colors.
const EXTRA_CATEGORY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  media: {
    bg: "bg-[#10B981]/10",
    border: "border-[#10B981]/40",
    text: "text-[#10B981]",
  },
  streaming: {
    bg: "bg-[#4ADE80]/10",
    border: "border-[#4ADE80]/40",
    text: "text-[#4ADE80]",
  },
};

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * Resolve the colour palette for a category.
 *
 * `canonicalIdOverride` lets callers (typically wired through `useCategoryRegistry`)
 * pass the registry-resolved canonical id directly when the stored text has been
 * renamed away from its slug (e.g. id=`media`, stored label=`Media & Podcast`).
 * Without this override we'd normalise to `media-and-podcast`, miss both the
 * canonical and extra style maps, and fall back to the dynamic hash palette.
 */
export function getCategoryStyle(category: string, canonicalIdOverride?: string) {
  const normalized = (canonicalIdOverride && canonicalIdOverride.trim())
    ? canonicalIdOverride.trim()
    : normalizeMarketCategory(category);
  if (normalized in CATEGORY_STYLES) {
    return CATEGORY_STYLES[normalized as CanonicalMarketCategory];
  }
  if (normalized in EXTRA_CATEGORY_STYLES) {
    return EXTRA_CATEGORY_STYLES[normalized];
  }
  if (!normalized || normalized === "misc") return DEFAULT_CATEGORY_STYLE;
  return DYNAMIC_CATEGORY_STYLES[hashString(normalized) % DYNAMIC_CATEGORY_STYLES.length];
}

export function getCategoryTextColor(category: string, canonicalIdOverride?: string) {
  return getCategoryStyle(category, canonicalIdOverride).text;
}

/** Hex color for charts and other non-Tailwind consumers. */
export function getCategoryHexColor(category: string, canonicalIdOverride?: string): string {
  const normalized = (canonicalIdOverride && canonicalIdOverride.trim())
    ? canonicalIdOverride.trim()
    : normalizeMarketCategory(category);
  if (normalized in CATEGORY_HEX) {
    return CATEGORY_HEX[normalized as CanonicalMarketCategory];
  }
  if (normalized in EXTRA_CATEGORY_HEX) {
    return EXTRA_CATEGORY_HEX[normalized]!;
  }
  if (!normalized || normalized === "misc") return CATEGORY_HEX.misc;
  return DYNAMIC_CATEGORY_HEX[hashString(normalized) % DYNAMIC_CATEGORY_HEX.length]!;
}

const SIZE_CLASSES = {
  default: "px-2 py-0.5 text-[10px]",
  /** Dense UI: rankings, spotlight cards on value page */
  sm: "px-1 py-0.5 text-[9px] leading-none font-medium",
} as const;

interface CategoryPillProps {
  category: string;
  /** Compact pill for dense layouts (e.g. rankings). */
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  "data-testid"?: string;
}

export function CategoryPill({
  category,
  size = "default",
  className = "",
  "data-testid": testId,
}: CategoryPillProps) {
  const style = getCategoryStyle(category);
  const sizeClass = SIZE_CLASSES[size];

  return (
    <span
      className={`inline-flex items-center rounded-full border w-fit whitespace-nowrap transition-all duration-200 hover:opacity-80 ${sizeClass} ${style.bg} ${style.border} ${style.text} ${className}`}
      data-testid={testId}
    >
      {getMarketCategoryLabel(category)}
    </span>
  );
}
