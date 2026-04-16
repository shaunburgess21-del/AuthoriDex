import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SuggestCategorySelect } from "@/components/suggest";
import { X, Plus } from "lucide-react";

export type OpinionOptionValue = { name: string; imageUrl?: string; personId?: string };

export type OpinionPollReviewValues = {
  title: string;
  category: string;
  summary: string;
  slug: string;
  visibility: string;
  options: OpinionOptionValue[];
};

export function OpinionPollReviewFields({
  values,
  onChange,
}: {
  values: OpinionPollReviewValues;
  onChange: (next: OpinionPollReviewValues) => void;
}) {
  const set = <K extends keyof OpinionPollReviewValues>(key: K, val: OpinionPollReviewValues[K]) =>
    onChange({ ...values, [key]: val });

  const updateOption = (idx: number, name: string) => {
    const next = [...values.options];
    next[idx] = { ...next[idx], name };
    set("options", next);
  };

  const removeOption = (idx: number) => {
    if (values.options.length <= 3) return;
    set("options", values.options.filter((_, i) => i !== idx));
  };

  const addOption = () => {
    if (values.options.length >= 20) return;
    set("options", [...values.options, { name: "" }]);
  };

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
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Summary (optional)</label>
        <Textarea
          value={values.summary}
          onChange={(e) => set("summary", e.target.value)}
          className="resize-none"
          rows={2}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">Slug</label>
        <Input value={values.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono text-xs" />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium">Options ({values.options.length})</label>
        </div>
        <div className="space-y-2">
          {values.options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-5 text-xs text-muted-foreground text-right">{idx + 1}.</span>
              {opt.imageUrl && (
                <img src={opt.imageUrl} alt="" className="h-7 w-7 rounded-md object-cover border border-border shrink-0" />
              )}
              <Input
                value={opt.name}
                onChange={(e) => updateOption(idx, e.target.value)}
                className="flex-1"
                placeholder={`Option ${idx + 1}`}
              />
              {opt.personId && (
                <span className="text-[10px] text-cyan-600 dark:text-cyan-400 shrink-0">Celebrity</span>
              )}
              {values.options.length > 3 && (
                <Button variant="ghost" size="icon" onClick={() => removeOption(idx)} className="shrink-0 h-7 w-7">
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {values.options.length < 20 && (
          <Button variant="ghost" size="sm" onClick={addOption} className="mt-2 text-muted-foreground">
            <Plus className="h-4 w-4 mr-1" /> Add Option
          </Button>
        )}
      </div>
    </div>
  );
}
