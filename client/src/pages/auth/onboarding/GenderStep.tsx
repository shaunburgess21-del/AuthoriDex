/**
 * Step 2 — Gender.
 *
 * Tap-to-select list of full-width options. Selected state uses the
 * VoxDex primary accent with a subtle glow + check-mark; unselected
 * rows feel like solid surfaces, not buttons-pretending-to-be-cards,
 * so the "tap on a row" affordance reads correctly on touch.
 */
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const GENDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "woman", label: "Woman" },
  { value: "man", label: "Man" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "I prefer not to say" },
];

interface GenderListProps {
  value: string | null;
  onChange: (value: string) => void;
}

export function GenderList({ value, onChange }: GenderListProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Gender"
      className="flex flex-col gap-3"
      data-testid="gender-list"
    >
      {GENDER_OPTIONS.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt.value)}
            data-testid={`gender-option-${opt.value}`}
            className={cn(
              "group relative flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all duration-200 active:scale-[0.99]",
              isSelected
                ? "border-primary/60 bg-primary/10 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25),0_0_24px_-8px_hsl(var(--primary)/0.55)]"
                : "border-border/60 bg-card/40 hover:border-foreground/30 hover:bg-card/70",
            )}
          >
            <span
              className={cn(
                "text-base font-medium transition-colors",
                isSelected ? "text-foreground" : "text-foreground/85",
              )}
            >
              {opt.label}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border transition-all duration-200",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/70 bg-transparent text-transparent",
              )}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
