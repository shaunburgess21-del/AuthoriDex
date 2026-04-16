import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { SuggestCategorySelect } from "@/components/suggest";

export type OpenMarketReviewValues = {
  title: string;
  category: string;
  slug: string;
  visibility: string;
  endAt: string;
  underlying: string;
  metric: string;
  strike: string;
  unit: string;
};

export function OpenMarketReviewFields({
  values,
  onChange,
  openMarketType,
  entriesCount,
}: {
  values: OpenMarketReviewValues;
  onChange: (next: OpenMarketReviewValues) => void;
  openMarketType: string;
  entriesCount: number;
}) {
  const set = <K extends keyof OpenMarketReviewValues>(key: K, val: OpenMarketReviewValues[K]) =>
    onChange({ ...values, [key]: val });

  const isUpdown = openMarketType === "updown";

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
      <div>
        <label className="text-sm font-medium mb-1 block">Slug</label>
        <Input value={values.slug} onChange={(e) => set("slug", e.target.value)} className="font-mono text-xs" />
      </div>
      <div>
        <label className="text-sm font-medium mb-1 block">End Date</label>
        <Input type="datetime-local" value={values.endAt} onChange={(e) => set("endAt", e.target.value)} />
      </div>
      {isUpdown && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Asset / Subject</label>
              <Input value={values.underlying} onChange={(e) => set("underlying", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Metric</label>
              <Input value={values.metric} onChange={(e) => set("metric", e.target.value)} placeholder="e.g. price" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Strike</label>
              <Input type="number" value={values.strike} onChange={(e) => set("strike", e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Unit</label>
              <Input value={values.unit} onChange={(e) => set("unit", e.target.value)} placeholder="$" />
            </div>
          </div>
        </>
      )}
      <div className="text-sm text-muted-foreground">
        {openMarketType === "binary" && "Entries: Yes / No (auto-generated)"}
        {openMarketType === "updown" && "Entries: Above / Below (auto-generated)"}
        {openMarketType === "multi" && `Entries: ${entriesCount} option${entriesCount === 1 ? "" : "s"} (from submission)`}
      </div>
    </div>
  );
}
