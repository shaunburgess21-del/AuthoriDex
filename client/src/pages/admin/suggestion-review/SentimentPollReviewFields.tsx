import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SuggestCategorySelect } from "@/components/suggest";

export type SentimentPollReviewValues = {
  headline: string;
  subjectText: string;
  category: string;
  slug: string;
  visibility: string;
  deadlineAt: string;
};

export function SentimentPollReviewFields({
  values,
  onChange,
}: {
  values: SentimentPollReviewValues;
  onChange: (next: SentimentPollReviewValues) => void;
}) {
  const set = <K extends keyof SentimentPollReviewValues>(key: K, val: SentimentPollReviewValues[K]) =>
    onChange({ ...values, [key]: val });

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1 block">Headline</label>
        <Input value={values.headline} onChange={(e) => set("headline", e.target.value)} />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Subject</label>
        <Input value={values.subjectText} onChange={(e) => set("subjectText", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SuggestCategorySelect value={values.category} onChange={(v) => set("category", v)} label="Category" />
        <div>
          <label className="text-sm font-medium mb-1 block">Visibility</label>
          <Select value={values.visibility} onValueChange={(v) => set("visibility", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Slug</label>
        <Input value={values.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono text-xs" />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Deadline</label>
        <Input
          type="datetime-local"
          value={values.deadlineAt}
          onChange={(e) => set("deadlineAt", e.target.value)}
        />
      </div>
    </div>
  );
}
