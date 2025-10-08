import { TrendBadge } from '../TrendBadge';

export default function TrendBadgeExample() {
  return (
    <div className="flex gap-4 items-center p-4">
      <TrendBadge value={12.5} />
      <TrendBadge value={-8.3} />
      <TrendBadge value={0} />
      <TrendBadge value={25.7} size="lg" />
    </div>
  );
}
