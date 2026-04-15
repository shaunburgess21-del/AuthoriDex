import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES_OPEN } from "@shared/constants";

interface SuggestCategorySelectProps {
  value: string;
  onChange: (value: string) => void;
  categories?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  label?: string;
  placeholder?: string;
  "data-testid"?: string;
}

export function SuggestCategorySelect({
  value,
  onChange,
  categories = CATEGORIES_OPEN,
  label = "Category *",
  placeholder = "Select category",
  "data-testid": testId,
}: SuggestCategorySelectProps) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
