const CATEGORY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  Tech: {
    bg: 'bg-cyan-500/10',
    border: 'border-cyan-400/40',
    text: 'text-cyan-300',
  },
  Music: {
    bg: 'bg-purple-500/10',
    border: 'border-purple-400/40',
    text: 'text-purple-300',
  },
  Politics: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/40',
    text: 'text-amber-300',
  },
  Business: {
    bg: 'bg-sky-500/10',
    border: 'border-sky-400/40',
    text: 'text-sky-300',
  },
  Sports: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/40',
    text: 'text-emerald-300',
  },
  Creator: {
    bg: 'bg-pink-500/10',
    border: 'border-pink-400/40',
    text: 'text-pink-300',
  },
  Entertainment: {
    bg: 'bg-pink-500/10',
    border: 'border-pink-400/40',
    text: 'text-pink-300',
  },
};

const DEFAULT_CATEGORY_STYLE = {
  bg: 'bg-slate-500/10',
  border: 'border-slate-400/40',
  text: 'text-slate-300',
};

export function getCategoryStyle(category: string) {
  return CATEGORY_STYLES[category] || DEFAULT_CATEGORY_STYLE;
}

export function getCategoryTextColor(category: string) {
  const style = CATEGORY_STYLES[category] || DEFAULT_CATEGORY_STYLE;
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
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border transition-all duration-200 hover:opacity-80 ${style.bg} ${style.border} ${style.text} ${className}`}
      data-testid={testId}
    >
      {category}
    </span>
  );
}
