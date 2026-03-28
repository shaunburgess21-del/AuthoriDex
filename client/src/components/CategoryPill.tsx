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
    bg: 'bg-[#B8860B]/10',
    border: 'border-[#B8860B]/40',
    text: 'text-[#B8860B]',
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
  misc: {
    bg: 'bg-[#94A3B8]/10',
    border: 'border-[#94A3B8]/40',
    text: 'text-[#94A3B8]',
  },
};

const DEFAULT_CATEGORY_STYLE = {
  bg: 'bg-[#94A3B8]/10',
  border: 'border-[#94A3B8]/40',
  text: 'text-[#94A3B8]',
};

export function getCategoryStyle(category: string) {
  const normalized = normalizeMarketCategory(category);
  if (normalized in CATEGORY_STYLES) {
    return CATEGORY_STYLES[normalized as CanonicalMarketCategory];
  }
  return DEFAULT_CATEGORY_STYLE;
}

export function getCategoryTextColor(category: string) {
  const style = getCategoryStyle(category);
  return style.text;
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
