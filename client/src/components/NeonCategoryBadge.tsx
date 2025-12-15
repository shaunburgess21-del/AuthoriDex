import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type CategoryType = "Tech" | "Music" | "Politics" | "Business" | "Creator" | "Sports" | string;
type BadgeVariant = "primary" | "secondary";

interface NeonCategoryBadgeProps {
  category: CategoryType;
  variant?: BadgeVariant;
  className?: string;
}

const categoryColors: Record<string, { neon: string; glow: string }> = {
  Tech: { neon: "#00FFFF", glow: "rgba(0, 255, 255, 0.4)" },
  Music: { neon: "#D900FF", glow: "rgba(217, 0, 255, 0.4)" },
  Politics: { neon: "#FFBF00", glow: "rgba(255, 191, 0, 0.4)" },
  Business: { neon: "#A7B6C9", glow: "rgba(167, 182, 201, 0.4)" },
  Creator: { neon: "#FF007F", glow: "rgba(255, 0, 127, 0.4)" },
  Sports: { neon: "#00FF88", glow: "rgba(0, 255, 136, 0.4)" },
};

const defaultColor = { neon: "#888888", glow: "rgba(136, 136, 136, 0.4)" };

function normalizeCategory(category: string): string {
  if (category.toLowerCase() === "entertainment") {
    return "Creator";
  }
  return category;
}

function getCategoryColors(category: string): { neon: string; glow: string } {
  const normalized = normalizeCategory(category);
  return categoryColors[normalized] || defaultColor;
}

export function NeonCategoryBadge({ 
  category, 
  variant = "primary",
  className 
}: NeonCategoryBadgeProps) {
  const displayCategory = normalizeCategory(category);
  const colors = getCategoryColors(category);

  if (variant === "secondary") {
    return (
      <span
        className={cn(
          "text-xs font-normal tracking-wide",
          className
        )}
        style={{ color: colors.neon }}
        data-testid={`badge-category-${displayCategory.toLowerCase()}`}
      >
        {displayCategory}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center px-3 py-1.5 rounded-full text-xs font-normal tracking-wide transition-all duration-200",
        "bg-black/12 border",
        "hover:shadow-[0_0_15px_var(--glow-color)]",
        className
      )}
      style={{ 
        borderColor: colors.neon, 
        color: colors.neon,
        "--glow-color": colors.glow 
      } as CSSProperties}
      data-testid={`badge-category-${displayCategory.toLowerCase()}`}
    >
      {displayCategory}
    </span>
  );
}

export { categoryColors, getCategoryColors, normalizeCategory };
