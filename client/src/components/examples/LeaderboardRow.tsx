import { LeaderboardRow } from '../LeaderboardRow';

export default function LeaderboardRowExample() {
  const mockPerson = {
    id: "1",
    name: "Taylor Swift",
    avatar: null,
    rank: 1,
    trendScore: 9850,
    change24h: 12.5,
    change7d: 23.8,
    category: "Music",
  };

  return (
    <div className="max-w-4xl">
      <LeaderboardRow 
        person={mockPerson} 
        onClick={() => console.log('Person clicked')} 
      />
    </div>
  );
}
