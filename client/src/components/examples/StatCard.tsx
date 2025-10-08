import { StatCard } from '../StatCard';
import { TrendingUp, Users, Activity } from 'lucide-react';

export default function StatCardExample() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      <StatCard title="Total Tracked" value="1,000" icon={Users} subtitle="Trending people" />
      <StatCard title="Top Score" value="9,850" icon={TrendingUp} subtitle="Highest trend score" />
      <StatCard title="Live Updates" value="5m" icon={Activity} subtitle="Refresh interval" />
    </div>
  );
}
