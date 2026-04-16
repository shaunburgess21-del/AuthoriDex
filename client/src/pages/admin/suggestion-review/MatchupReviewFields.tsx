import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SuggestCategorySelect } from "@/components/suggest";

export type MatchupReviewValues = {
  title: string;
  category: string;
  optionAText: string;
  optionBText: string;
  slug: string;
  visibility: string;
};

export function MatchupReviewFields({
  values,
  onChange,
}: {
  values: MatchupReviewValues;
  onChange: (next: MatchupReviewValues) => void;
}) {
  const set = <K extends keyof MatchupReviewValues>(key: K, val: MatchupReviewValues[K]) =>
    onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">Title</label>
        <Input value={values.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SuggestCategorySelect value={values.category} onChange={(v) => set("category", v)} label="Category" />
        <div>
          <label className="text-sm font-medium mb-1 block">Visibility</label>
          <Select value={values.visibility} onValueChange={(v) => set("visibility", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium mb-1 block">Option A</label>
          <Input value={values.optionAText} onChange={(e) => set("optionAText", e.target.value)} />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Option B</label>
          <Input value={values.optionBText} onChange={(e) => set("optionBText", e.target.value)} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Slug</label>
        <Input value={values.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono text-xs" />
      </div>
    </div>
  );
}
