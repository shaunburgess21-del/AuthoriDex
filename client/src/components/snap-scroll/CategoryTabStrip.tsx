import { useRef, useEffect } from "react";
import { getCategoryStyle } from "@/components/CategoryPill";
import { getMarketCategoryLabel } from "@shared/constants";

interface CategoryTabStripProps {
  categories: string[];
  activeCategory: string;
  onSelect: (category: string) => void;
}

const ACTIVE_HEX: Record<string, string> = {
  tech: "#1E90FF",
  music: "#EC4899",
  politics: "#94A3B8",
  business: "#B8860B",
  sports: "#FB923C",
  "film-tv": "#A855F7",
  gaming: "#7C3AED",
  creator: "#FACC15",
  comedy: "#F97316",
  "food-drink": "#D97706",
  lifestyle: "#DB2777",
  misc: "#94A3B8",
};

function getHexColor(category: string): string {
  const style = getCategoryStyle(category);
  const match = style.text.match(/\[([#\w]+)\]/);
  if (match) return match[1];
  return ACTIVE_HEX[category.toLowerCase()] || "#06B6D4";
}

export function CategoryTabStrip({ categories, activeCategory, onSelect }: CategoryTabStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const el = activeRef.current;
      const offset = el.offsetLeft - container.offsetWidth / 2 + el.offsetWidth / 2;
      container.scrollTo({ left: offset, behavior: "smooth" });
    }
  }, [activeCategory]);

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-1 overflow-x-auto scrollbar-hide px-4 py-2"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {categories.map((cat) => {
        const isActive = cat === activeCategory;
        const hex = getHexColor(cat);
        const label = cat === "All" ? "All" : getMarketCategoryLabel(cat);

        return (
          <button
            key={cat}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSelect(cat)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
              isActive ? "" : "text-muted-foreground dark:text-white/45"
            }`}
            style={
              isActive
                ? { color: hex, opacity: 1 }
                : { opacity: 0.7 }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
