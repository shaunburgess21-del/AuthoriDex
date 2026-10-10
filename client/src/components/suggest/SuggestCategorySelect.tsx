import { normalizeMarketCategory } from "@shared/constants";
import { getCategoryStyle } from "@/components/CategoryPill";
import { getCategoryIcon } from "@/components/interests/categoryIcons";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";

interface SuggestCategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  categories?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  label?: string;
  /** @deprecated kept for back-compat; no longer rendered (inline chip picker has no placeholder). */
  placeholder?: string;
  "data-testid"?: string;
}

export function SuggestCategorySelect({
  value,
  onChange,
  categories,
  label = "Category *",
  "data-testid": testId,
}: SuggestCategorySelectProps) {
  const registry = useCategoryRegistry();
  const options = categories ?? registry.categories;

  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">{label}</label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label} data-testid={testId}>
        {options.map((c) => {
          const isSelected = value === c.id;
          const style = getCategoryStyle(c.id, normalizeMarketCategory(c.id));
          const Icon = getCategoryIcon(normalizeMarketCategory(c.id));
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(c.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                isSelected
                  ? `${style.bg} ${style.border} ${style.text}`
                  : "bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
              }`}
              data-testid={testId ? `${testId}-${c.id}` : undefined}
            >
              <Icon className="h-3.5 w-3.5" />
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
