import { Input } from "@/components/ui/input";
import { SuggestCategorySelect } from "@/components/suggest";
import { useCategoryRegistry } from "@/hooks/useCategoryRegistry";

export type InductionReviewValues = {
  displayName: string;
  category: string;
  xHandle: string;
};

export function InductionReviewFields({
  values,
  onChange,
  socialUrl,
}: {
  values: InductionReviewValues;
  onChange: (next: InductionReviewValues) => void;
  socialUrl: string | null;
}) {
  const registry = useCategoryRegistry();
  const leaderboardCategories = registry.categories.filter((c) => c.id !== "misc");
  const set = <K extends keyof InductionReviewValues>(key: K, val: InductionReviewValues[K]) =>
    onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">Display Name</label>
        <Input value={values.displayName} onChange={(e) => set("displayName", e.target.value)} />
      </div>
      <SuggestCategorySelect
        value={values.category}
        onChange={(v) => set("category", v)}
        categories={leaderboardCategories}
        label="Category"
      />
      <div>
        <label className="text-sm font-medium mb-1 block">X Handle</label>
        <div className="flex items-center gap-1">
          <span className="text-sm text-muted-foreground">@</span>
          <Input
            value={values.xHandle}
            onChange={(e) => set("xHandle", e.target.value.replace(/^@+/, ""))}
            placeholder="handle"
          />
        </div>
      </div>
      {socialUrl && (
        <div>
          <label className="text-sm font-medium mb-1 block text-muted-foreground">Social URL (submitted)</label>
          <p className="text-sm font-mono truncate">{socialUrl}</p>
        </div>
      )}
    </div>
  );
}
