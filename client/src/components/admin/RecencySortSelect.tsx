import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RecencySort } from "@/lib/recencySort";

interface RecencySortSelectProps {
  value: RecencySort;
  onValueChange: (value: RecencySort) => void;
  className?: string;
  testId?: string;
}

/** Shared newest/oldest sort dropdown for the Voting CMS tabs. */
export function RecencySortSelect({
  value,
  onValueChange,
  className = "w-[150px]",
  testId = "select-recency-sort",
}: RecencySortSelectProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as RecencySort)}>
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder="Sort" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Default order</SelectItem>
        <SelectItem value="newest">Newest first</SelectItem>
        <SelectItem value="oldest">Oldest first</SelectItem>
      </SelectContent>
    </Select>
  );
}
