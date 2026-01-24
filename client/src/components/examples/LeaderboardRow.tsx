import { LeaderboardRow } from '../LeaderboardRow';

export default function LeaderboardRowExample() {
  const mockPerson = {
    id: "1",
    name: "Taylor Swift",
    avatar: null,
    bio: null,
    rank: 1,
    trendScore: 985000,
    fameIndex: 9850,
    change24h: 12.5,
    change7d: 23.8,
    category: "Entertainment",
  };

  return (
    <div className="max-w-4xl">
      <LeaderboardRow 
        person={mockPerson} 
        onVisitProfile={() => console.log('Visit profile clicked')} 
        onVoteClick={() => console.log('Vote clicked')}
      />
    </div>
  );
}
