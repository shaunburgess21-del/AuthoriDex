import { Input } from "@/components/ui/input";

export const DURATION_PRESETS = [
  { label: "No Deadline", value: "none" },
  { label: "1 Week", value: "1week" },
  { label: "1 Month", value: "1month" },
  { label: "Custom", value: "custom" },
] as const;

interface SuggestDurationPickerProps {
  value: string;
  onChange: (value: string) => void;
  customDate: string;
  onCustomDateChange: (value: string) => void;
  testIdPrefix?: string;
}

export function SuggestDurationPicker({
  value,
  onChange,
  customDate,
  onCustomDateChange,
  testIdPrefix = "poll",
}: SuggestDurationPickerProps) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">Timeline</label>
      <div className="flex flex-wrap gap-2">
        {DURATION_PRESETS.map((preset) => (
          <button
            key={preset.value}
            onClick={() => onChange(preset.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              value === preset.value
                ? "bg-cyan-500/25 dark:bg-cyan-500/20 border-cyan-500/50 dark:border-cyan-500/40 text-cyan-700 dark:text-cyan-300"
                : "bg-muted/50 border-border/60 text-muted-foreground hover:border-foreground/30 dark:bg-slate-800/30 dark:border-slate-700/40 dark:text-slate-400 dark:hover:border-slate-600"
            }`}
            data-testid={`${testIdPrefix}-duration-${preset.value}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      {value === "custom" && (
        <Input
          type="datetime-local"
          value={customDate}
          onChange={(e) => onCustomDateChange(e.target.value)}
          className="mt-2"
          data-testid={`input-${testIdPrefix}-custom-date`}
        />
      )}
    </div>
  );
}
