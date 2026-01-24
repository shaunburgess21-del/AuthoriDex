export type CategoryFilter = "all" | "favorites" | "tech" | "politics" | "business" | "entertainment" | "sports" | "creator";

export interface PredictionMarket {
  id: string;
  personId: string;
  personName: string;
  personAvatar: string;
  currentScore: number;
  startScore: number;
  change7d: number;
  upMultiplier: number;
  downMultiplier: number;
  endTime: string;
  totalPool: number;
  upPoolPercent: number;
  category: CategoryFilter;
}

export const MOCK_MARKETS: PredictionMarket[] = [
  {
    id: "market-1",
    personId: "1",
    personName: "Elon Musk",
    personAvatar: "",
    currentScore: 515809,
    startScore: 492100,
    change7d: 4.78,
    upMultiplier: 1.7,
    downMultiplier: 2.3,
    endTime: "Sun 23:59 UTC",
    totalPool: 15420,
    upPoolPercent: 58,
    category: "tech",
  },
  {
    id: "market-2",
    personId: "2",
    personName: "Taylor Swift",
    personAvatar: "",
    currentScore: 489234,
    startScore: 505500,
    change7d: -3.2,
    upMultiplier: 2.1,
    downMultiplier: 1.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 12350,
    upPoolPercent: 45,
    category: "entertainment",
  },
  {
    id: "market-3",
    personId: "3",
    personName: "MrBeast",
    personAvatar: "",
    currentScore: 504734,
    startScore: 531000,
    change7d: -4.95,
    upMultiplier: 1.5,
    downMultiplier: 2.8,
    endTime: "Sun 23:59 UTC",
    totalPool: 9870,
    upPoolPercent: 65,
    category: "creator",
  },
  {
    id: "market-4",
    personId: "4",
    personName: "Donald Trump",
    personAvatar: "",
    currentScore: 484531,
    startScore: 501300,
    change7d: -3.35,
    upMultiplier: 1.4,
    downMultiplier: 3.2,
    endTime: "Sun 23:59 UTC",
    totalPool: 22100,
    upPoolPercent: 72,
    category: "politics",
  },
  {
    id: "market-5",
    personId: "5",
    personName: "Cristiano Ronaldo",
    personAvatar: "",
    currentScore: 445678,
    startScore: 436500,
    change7d: 2.1,
    upMultiplier: 1.9,
    downMultiplier: 2.0,
    endTime: "Sun 23:59 UTC",
    totalPool: 11200,
    upPoolPercent: 51,
    category: "sports",
  },
];

export interface HeadToHeadMarket {
  id: string;
  title: string;
  person1: { name: string; avatar: string; currentScore: number };
  person2: { name: string; avatar: string; currentScore: number };
  category: CategoryFilter;
  endTime: string;
  totalPool: number;
  person1Percent: number;
}

export const HEAD_TO_HEAD_MARKETS: HeadToHeadMarket[] = [
  {
    id: "h2h-1",
    title: "Drake vs Kendrick",
    person1: { name: "Drake", avatar: "", currentScore: 425600 },
    person2: { name: "Kendrick Lamar", avatar: "", currentScore: 398200 },
    category: "entertainment",
    endTime: "Sun 23:59 UTC",
    totalPool: 28450,
    person1Percent: 42,
  },
  {
    id: "h2h-2",
    title: "Musk vs Zuckerberg",
    person1: { name: "Elon Musk", avatar: "", currentScore: 515809 },
    person2: { name: "Mark Zuckerberg", avatar: "", currentScore: 312400 },
    category: "tech",
    endTime: "Sun 23:59 UTC",
    totalPool: 19200,
    person1Percent: 68,
  },
  {
    id: "h2h-3",
    title: "Swift vs Beyoncé",
    person1: { name: "Taylor Swift", avatar: "", currentScore: 489234 },
    person2: { name: "Beyoncé", avatar: "", currentScore: 478200 },
    category: "entertainment",
    endTime: "Sun 23:59 UTC",
    totalPool: 15780,
    person1Percent: 55,
  },
  {
    id: "h2h-4",
    title: "Ronaldo vs Messi",
    person1: { name: "Cristiano Ronaldo", avatar: "", currentScore: 445678 },
    person2: { name: "Lionel Messi", avatar: "", currentScore: 432100 },
    category: "sports",
    endTime: "Sun 23:59 UTC",
    totalPool: 34100,
    person1Percent: 48,
  },
];

export interface TopGainerMarket {
  id: string;
  category: CategoryFilter;
  leaders: { name: string; avatar: string; currentGain: number; percentGain: number }[];
  totalPool: number;
  endTime: string;
}

export const TOP_GAINER_MARKETS: TopGainerMarket[] = [
  {
    id: "gainer-1",
    category: "entertainment",
    leaders: [
      { name: "Taylor Swift", avatar: "", currentGain: 12450, percentGain: 4.2 },
      { name: "Drake", avatar: "", currentGain: 8920, percentGain: 3.8 },
      { name: "Bad Bunny", avatar: "", currentGain: 7340, percentGain: 2.9 },
    ],
    totalPool: 14200,
    endTime: "Sun 23:59 UTC",
  },
  {
    id: "gainer-2",
    category: "tech",
    leaders: [
      { name: "Jensen Huang", avatar: "", currentGain: 15780, percentGain: 8.5 },
      { name: "Elon Musk", avatar: "", currentGain: 11200, percentGain: 2.1 },
      { name: "Sam Altman", avatar: "", currentGain: 9850, percentGain: 5.2 },
    ],
    totalPool: 19800,
    endTime: "Sun 23:59 UTC",
  },
];

export interface CommunityMarket {
  id: string;
  question: string;
  category: CategoryFilter;
  options: { id: string; text: string; percent: number }[];
  totalPool: number;
  endTime: string;
  creatorName: string;
  personName: string;
  personAvatar: string;
  participants: number;
}

export const COMMUNITY_MARKETS: CommunityMarket[] = [
  {
    id: "comm-1",
    question: "Will Elon tweet about Dogecoin this week?",
    category: "tech",
    options: [
      { id: "yes", text: "Yes", percent: 72 },
      { id: "no", text: "No", percent: 28 },
    ],
    totalPool: 3420,
    endTime: "Sun 23:59 UTC",
    creatorName: "CryptoKing99",
    personName: "Elon Musk",
    personAvatar: "",
    participants: 47,
  },
  {
    id: "comm-2",
    question: "Taylor Swift album announcement before month end?",
    category: "entertainment",
    options: [
      { id: "yes", text: "Yes", percent: 52 },
      { id: "no", text: "No", percent: 48 },
    ],
    totalPool: 2890,
    endTime: "Sun 23:59 UTC",
    creatorName: "SwiftieForever",
    personName: "Taylor Swift",
    personAvatar: "",
    participants: 89,
  },
  {
    id: "comm-3",
    question: "Jensen Huang keynote will break 1M views in 24h?",
    category: "tech",
    options: [
      { id: "yes", text: "Yes", percent: 65 },
      { id: "no", text: "No", percent: 35 },
    ],
    totalPool: 1560,
    endTime: "Sun 23:59 UTC",
    creatorName: "TechWatcher",
    personName: "Jensen Huang",
    personAvatar: "",
    participants: 23,
  },
];

export const CATEGORY_FILTERS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "tech", label: "Tech" },
  { id: "politics", label: "Politics" },
  { id: "business", label: "Business" },
  { id: "entertainment", label: "Entertainment" },
  { id: "sports", label: "Sports" },
  { id: "creator", label: "Creator" },
];
