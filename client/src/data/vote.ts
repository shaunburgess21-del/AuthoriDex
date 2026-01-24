export interface FaceOffData {
  id: string;
  category: string;
  title: string;
  optionAText: string;
  optionAImage: string | null;
  optionBText: string;
  optionBImage: string | null;
  isActive: boolean;
  createdAt: string;
  optionAVotes: number;
  optionBVotes: number;
  totalVotes: number;
  optionAPercent: number;
  optionBPercent: number;
}

export const FACE_OFF_DATA: FaceOffData[] = [
  {
    id: "fo-1",
    category: "Entertainment",
    title: "Pop Icon Showdown",
    optionAText: "Taylor Swift",
    optionAImage: null,
    optionBText: "Beyoncé",
    optionBImage: null,
    isActive: true,
    createdAt: "2024-01-01",
    optionAVotes: 15420,
    optionBVotes: 12890,
    totalVotes: 28310,
    optionAPercent: 54,
    optionBPercent: 46,
  },
  {
    id: "fo-2",
    category: "Tech",
    title: "Tech Titans",
    optionAText: "Elon Musk",
    optionAImage: null,
    optionBText: "Mark Zuckerberg",
    optionBImage: null,
    isActive: true,
    createdAt: "2024-01-01",
    optionAVotes: 21340,
    optionBVotes: 8760,
    totalVotes: 30100,
    optionAPercent: 71,
    optionBPercent: 29,
  },
  {
    id: "fo-3",
    category: "Sports",
    title: "GOAT Debate",
    optionAText: "Cristiano Ronaldo",
    optionAImage: null,
    optionBText: "Lionel Messi",
    optionBImage: null,
    isActive: true,
    createdAt: "2024-01-01",
    optionAVotes: 18900,
    optionBVotes: 22100,
    totalVotes: 41000,
    optionAPercent: 46,
    optionBPercent: 54,
  },
  {
    id: "fo-4",
    category: "Creator",
    title: "YouTube Kings",
    optionAText: "MrBeast",
    optionAImage: null,
    optionBText: "Logan Paul",
    optionBImage: null,
    isActive: true,
    createdAt: "2024-01-01",
    optionAVotes: 25600,
    optionBVotes: 8400,
    totalVotes: 34000,
    optionAPercent: 75,
    optionBPercent: 25,
  },
  {
    id: "fo-5",
    category: "Entertainment",
    title: "Rap Legends",
    optionAText: "Drake",
    optionAImage: null,
    optionBText: "Kendrick Lamar",
    optionBImage: null,
    isActive: true,
    createdAt: "2024-01-01",
    optionAVotes: 14200,
    optionBVotes: 16800,
    totalVotes: 31000,
    optionAPercent: 46,
    optionBPercent: 54,
  },
];

export interface DiscourseTopicData {
  id: string;
  headline: string;
  description: string;
  category: string;
  approvePercent: number;
  neutralPercent: number;
  disapprovePercent: number;
  totalVotes: number;
}

export const DISCOURSE_TOPICS: DiscourseTopicData[] = [
  { id: "d1", headline: "Elon buys Twitter", description: "Was the $44B acquisition a smart move?", category: "Tech", approvePercent: 35, neutralPercent: 20, disapprovePercent: 45, totalVotes: 89432 },
  { id: "d2", headline: "AI replacing jobs", description: "Should we embrace or regulate AI in the workplace?", category: "Tech", approvePercent: 28, neutralPercent: 32, disapprovePercent: 40, totalVotes: 156789 },
  { id: "d3", headline: "Taylor's Eras Tour pricing", description: "Are dynamic ticket prices fair to fans?", category: "Entertainment", approvePercent: 15, neutralPercent: 25, disapprovePercent: 60, totalVotes: 234567 },
  { id: "d4", headline: "Spotify's royalty model", description: "Are artists fairly compensated by streaming?", category: "Entertainment", approvePercent: 22, neutralPercent: 28, disapprovePercent: 50, totalVotes: 145678 },
  { id: "d5", headline: "MrBeast's philanthropy", description: "Is it genuine or just content?", category: "Creator", approvePercent: 68, neutralPercent: 20, disapprovePercent: 12, totalVotes: 98765 },
  { id: "d6", headline: "NFL Sunday Ticket pricing", description: "Is streaming football too expensive?", category: "Sports", approvePercent: 18, neutralPercent: 22, disapprovePercent: 60, totalVotes: 76543 },
];

export interface InductionCandidate {
  id: string;
  name: string;
  initials: string;
  category: "Tech" | "Entertainment" | "Creator" | "Sports" | "Business" | "Politics";
  votes: number;
}

export const INDUCTION_CANDIDATES: InductionCandidate[] = [
  { id: "i1", name: "Jensen Huang", initials: "JH", category: "Tech", votes: 12406 },
  { id: "i2", name: "Charli XCX", initials: "CX", category: "Entertainment", votes: 11205 },
  { id: "i3", name: "Kai Cenat", initials: "KC", category: "Creator", votes: 10892 },
  { id: "i4", name: "Sabrina Carpenter", initials: "SC", category: "Entertainment", votes: 9847 },
  { id: "i5", name: "Ice Spice", initials: "IS", category: "Entertainment", votes: 8934 },
  { id: "i6", name: "Sam Altman", initials: "SA", category: "Tech", votes: 8421 },
];

export interface CurateProfilePoll {
  id: string;
  personName: string;
  category: string;
  totalVotes: number;
  photoOptions: { id: string; description: string; votes: number; isLeading: boolean }[];
}

export const CURATE_PROFILE_POLLS: CurateProfilePoll[] = [
  { 
    id: "pp1", 
    personName: "Taylor Swift", 
    category: "Entertainment",
    totalVotes: 24680,
    photoOptions: [
      { id: "ts1", description: "Eras Tour red outfit", votes: 8934, isLeading: true },
      { id: "ts2", description: "Grammy Awards 2024", votes: 6721, isLeading: false },
      { id: "ts3", description: "Midnights album cover", votes: 5432, isLeading: false },
      { id: "ts4", description: "NFL game candid", votes: 3593, isLeading: false },
    ]
  },
  { 
    id: "pp2", 
    personName: "Elon Musk", 
    category: "Tech",
    totalVotes: 18543,
    photoOptions: [
      { id: "em1", description: "SpaceX launch event", votes: 7234, isLeading: true },
      { id: "em2", description: "Tesla factory tour", votes: 5421, isLeading: false },
      { id: "em3", description: "X/Twitter HQ", votes: 3654, isLeading: false },
    ]
  },
  { 
    id: "pp3", 
    personName: "MrBeast", 
    category: "Creator",
    totalVotes: 15678,
    photoOptions: [
      { id: "mb1", description: "Challenge video thumbnail", votes: 6789, isLeading: true },
      { id: "mb2", description: "Beast Burger launch", votes: 4567, isLeading: false },
      { id: "mb3", description: "Philanthropy event", votes: 4322, isLeading: false },
    ]
  },
];

export const FILTER_CATEGORIES = ["All", "Favorites", "Tech", "Entertainment", "Sports", "Creator", "Business", "Politics"] as const;
export type FilterCategory = typeof FILTER_CATEGORIES[number];
