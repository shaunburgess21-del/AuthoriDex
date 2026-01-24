import { TrendWidget } from '../TrendWidget';

export default function TrendWidgetExample() {
  const mockPeople = [
    { id: "1", name: "Person A", rank: 1, trendScore: 950000, fameIndex: 9500, change24h: 15.2, change7d: 45.3, category: "Entertainment", avatar: null, bio: null },
    { id: "2", name: "Person B", rank: 2, trendScore: 920000, fameIndex: 9200, change24h: 12.8, change7d: 38.1, category: "Sports", avatar: null, bio: null },
    { id: "3", name: "Person C", rank: 3, trendScore: 890000, fameIndex: 8900, change24h: 10.5, change7d: 32.7, category: "Tech", avatar: null, bio: null },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
      <TrendWidget title="Daily Movers" people={mockPeople} type="daily" />
      <TrendWidget title="Weekly Gainers" people={mockPeople} type="gainer" />
      <TrendWidget title="Weekly Droppers" people={mockPeople} type="dropper" />
    </div>
  );
}
