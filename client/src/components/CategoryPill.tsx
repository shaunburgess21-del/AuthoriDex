const CATEGORY_LABEL_MAP: Record<string, string> = {
  misc: "Custom Topic",
};

const CATEGORY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  Tech: {
    bg: 'bg-[#1E90FF]/10',
    border: 'border-[#1E90FF]/40',
    text: 'text-[#1E90FF]',
  },
  Music: {
    bg: 'bg-[#EC4899]/10',
    border: 'border-[#EC4899]/40',
    text: 'text-[#EC4899]',
  },
  Politics: {
    bg: 'bg-[#94A3B8]/10',
    border: 'border-[#94A3B8]/40',
    text: 'text-[#94A3B8]',
  },
  Business: {
    bg: 'bg-[#B8860B]/10',
    border: 'border-[#B8860B]/40',
    text: 'text-[#B8860B]',
  },
  Sports: {
    bg: 'bg-[#FB923C]/10',
    border: 'border-[#FB923C]/40',
    text: 'text-[#FB923C]',
  },
  Creator: {
    bg: 'bg-[#FACC15]/10',
    border: 'border-[#FACC15]/40',
    text: 'text-[#FACC15]',
  },
  misc: {
    bg: 'bg-[#8B5CF6]/10',
    border: 'border-[#8B5CF6]/40',
    text: 'text-[#8B5CF6]',
  },
};

const DEFAULT_CATEGORY_STYLE = {
  bg: 'bg-[#94A3B8]/10',
  border: 'border-[#94A3B8]/40',
  text: 'text-[#94A3B8]',
};

export function getCategoryStyle(category: string) {
  if (CATEGORY_STYLES[category]) return CATEGORY_STYLES[category];
  const normalized = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
  return CATEGORY_STYLES[normalized] || DEFAULT_CATEGORY_STYLE;
}

export function getCategoryTextColor(category: string) {
  const style = getCategoryStyle(category);
  return style.text;
}

interface CategoryPillProps {
  category: string;
  className?: string;
  "data-testid"?: string;
}

export function CategoryPill({ category, className = "", "data-testid": testId }: CategoryPillProps) {
  const style = getCategoryStyle(category);
  
  return (
    <span 
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border w-fit whitespace-nowrap transition-all duration-200 hover:opacity-80 ${style.bg} ${style.border} ${style.text} ${className}`}
      data-testid={testId}
    >
      {CATEGORY_LABEL_MAP[category] || category}
    </span>
  );
}
