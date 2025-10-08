import { RankBadge } from '../RankBadge';

export default function RankBadgeExample() {
  return (
    <div className="flex gap-3 items-center p-4">
      <RankBadge rank={1} />
      <RankBadge rank={5} />
      <RankBadge rank={15} />
      <RankBadge rank={100} />
    </div>
  );
}
