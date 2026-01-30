import { supabaseServer } from "./supabase";
import { db } from "./db";
import { trackedPeople, celebrityMetrics, trendingPeople } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

const SEED_USER_ID = "seed-system-approval";

// Manual name mapping for seed names → database names
const NAME_MAPPING: Record<string, string> = {
  "MrBeast": "Mr Beast",
  "Beyonce": "Beyoncé",
  "Lisa": "Lisa (Blackpink)",
};

// Normalize names for fuzzy matching: lowercase, strip accents, remove special chars
function normalizeNameForMatch(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accent marks
    .replace(/[^a-z0-9\s]/g, "") // Remove special chars except spaces
    .replace(/\s+/g, " ")
    .trim();
}

interface SeedCelebrity {
  rank: number;
  name: string;
  category: string;
  wikiSlug: string;
  xHandle: string;
  status: string;
  totalVotes: number;
  approvalPercent: number;
  avgRating: number;
}

const SEED_DATA: SeedCelebrity[] = [
  { rank: 1, name: "Elon Musk", category: "Tech", wikiSlug: "Elon_Musk", xHandle: "elonmusk", status: "Active", totalVotes: 1535, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 2, name: "Donald Trump", category: "Politics", wikiSlug: "Donald_Trump", xHandle: "realDonaldTrump", status: "Active", totalVotes: 1389, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 3, name: "Taylor Swift", category: "Music", wikiSlug: "Taylor_Swift", xHandle: "taylorswift13", status: "Active", totalVotes: 1314, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 4, name: "Cristiano Ronaldo", category: "Sports", wikiSlug: "Cristiano_Ronaldo", xHandle: "Cristiano", status: "Active", totalVotes: 1391, approvalPercent: 0.96, avgRating: 4.84 },
  { rank: 5, name: "MrBeast", category: "Creator", wikiSlug: "MrBeast", xHandle: "MrBeast", status: "Active", totalVotes: 712, approvalPercent: 0.94, avgRating: 4.76 },
  { rank: 6, name: "Jensen Huang", category: "Tech", wikiSlug: "Jensen_Huang", xHandle: "nvidia", status: "Active", totalVotes: 772, approvalPercent: 0.94, avgRating: 4.76 },
  { rank: 7, name: "Narendra Modi", category: "Politics", wikiSlug: "Narendra_Modi", xHandle: "narendramodi", status: "Active", totalVotes: 884, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 8, name: "Lionel Messi", category: "Sports", wikiSlug: "Lionel_Messi", xHandle: "TeamMessi", status: "Active", totalVotes: 1171, approvalPercent: 0.95, avgRating: 4.8 },
  { rank: 9, name: "Sam Altman", category: "Tech", wikiSlug: "Sam_Altman", xHandle: "sama", status: "Active", totalVotes: 244, approvalPercent: 0.81, avgRating: 4.24 },
  { rank: 10, name: "Beyonce", category: "Music", wikiSlug: "Beyonce", xHandle: "Beyonce", status: "Active", totalVotes: 340, approvalPercent: 0.83, avgRating: 4.32 },
  { rank: 11, name: "Mark Zuckerberg", category: "Tech", wikiSlug: "Mark_Zuckerberg", xHandle: "finkd", status: "Active", totalVotes: 387, approvalPercent: 0.81, avgRating: 4.24 },
  { rank: 12, name: "Joe Rogan", category: "Creator", wikiSlug: "Joe_Rogan", xHandle: "joerogan", status: "Active", totalVotes: 1227, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 13, name: "Vladimir Putin", category: "Politics", wikiSlug: "Vladimir_Putin", xHandle: "KremlinRussia_E", status: "Active", totalVotes: 463, approvalPercent: 0.74, avgRating: 3.96 },
  { rank: 14, name: "Jeff Bezos", category: "Business", wikiSlug: "Jeff_Bezos", xHandle: "JeffBezos", status: "Active", totalVotes: 364, approvalPercent: 0.80, avgRating: 4.2 },
  { rank: 15, name: "LeBron James", category: "Sports", wikiSlug: "LeBron_James", xHandle: "KingJames", status: "Active", totalVotes: 244, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 16, name: "Xi Jinping", category: "Politics", wikiSlug: "Xi_Jinping", xHandle: "", status: "Active", totalVotes: 738, approvalPercent: 0.81, avgRating: 4.24 },
  { rank: 17, name: "Kendrick Lamar", category: "Music", wikiSlug: "Kendrick_Lamar", xHandle: "kendricklamar", status: "Active", totalVotes: 463, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 18, name: "Kylian Mbappé", category: "Sports", wikiSlug: "Kylian_Mbappé", xHandle: "KMbappe", status: "Active", totalVotes: 365, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 19, name: "Tim Cook", category: "Tech", wikiSlug: "Tim_Cook", xHandle: "tim_cook", status: "Active", totalVotes: 228, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 20, name: "Kai Cenat", category: "Creator", wikiSlug: "Kai_Cenat", xHandle: "KaiCenat", status: "Active", totalVotes: 148, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 21, name: "Drake", category: "Music", wikiSlug: "Drake_(musician)", xHandle: "Drake", status: "Active", totalVotes: 542, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 22, name: "Kim Kardashian", category: "Creator", wikiSlug: "Kim_Kardashian", xHandle: "KimKardashian", status: "Queue", totalVotes: 277, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 23, name: "Kylie Jenner", category: "Creator", wikiSlug: "Kylie_Jenner", xHandle: "KylieJenner", status: "Queue", totalVotes: 329, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 24, name: "Kendall Jenner", category: "Creator", wikiSlug: "Kendall_Jenner", xHandle: "KendallJenner", status: "Queue", totalVotes: 340, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 25, name: "Satya Nadella", category: "Tech", wikiSlug: "Satya_Nadella", xHandle: "satyanadella", status: "Active", totalVotes: 241, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 26, name: "Bill Gates", category: "Tech", wikiSlug: "Bill_Gates", xHandle: "BillGates", status: "Active", totalVotes: 169, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 27, name: "Rihanna", category: "Music", wikiSlug: "Rihanna", xHandle: "rihanna", status: "Active", totalVotes: 295, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 28, name: "Virat Kohli", category: "Sports", wikiSlug: "Virat_Kohli", xHandle: "imVkohli", status: "Active", totalVotes: 227, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 29, name: "Logan Paul", category: "Creator", wikiSlug: "Logan_Paul", xHandle: "LoganPaul", status: "Active", totalVotes: 367, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 30, name: "Volodymyr Zelenskyy", category: "Politics", wikiSlug: "Volodymyr_Zelenskyy", xHandle: "ZelenskyyUa", status: "Active", totalVotes: 556, approvalPercent: 0.81, avgRating: 4.24 },
  { rank: 31, name: "Bad Bunny", category: "Music", wikiSlug: "Bad_Bunny", xHandle: "sanbenito", status: "Active", totalVotes: 291, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 32, name: "Larry Ellison", category: "Tech", wikiSlug: "Larry_Ellison", xHandle: "larryellison", status: "Active", totalVotes: 154, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 33, name: "Emmanuel Macron", category: "Politics", wikiSlug: "Emmanuel_Macron", xHandle: "EmmanuelMacron", status: "Active", totalVotes: 154, approvalPercent: 0.81, avgRating: 4.24 },
  { rank: 34, name: "Lewis Hamilton", category: "Sports", wikiSlug: "Lewis_Hamilton", xHandle: "LewisHamilton", status: "Active", totalVotes: 620, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 35, name: "IShowSpeed", category: "Creator", wikiSlug: "IShowSpeed", xHandle: "ishowspeedsui", status: "Active", totalVotes: 556, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 36, name: "Sundar Pichai", category: "Tech", wikiSlug: "Sundar_Pichai", xHandle: "sundarpichai", status: "Active", totalVotes: 183, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 37, name: "Stephen Curry", category: "Sports", wikiSlug: "Stephen_Curry", xHandle: "StephenCurry30", status: "Active", totalVotes: 227, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 38, name: "Charli D'Amelio", category: "Creator", wikiSlug: "Charli_D'Amelio", xHandle: "charlidamelio", status: "Active", totalVotes: 589, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 39, name: "Lisa Su", category: "Tech", wikiSlug: "Lisa_Su", xHandle: "LisaSu", status: "Active", totalVotes: 202, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 40, name: "Keir Starmer", category: "Politics", wikiSlug: "Keir_Starmer", xHandle: "Keir_Starmer", status: "Active", totalVotes: 305, approvalPercent: 0.79, avgRating: 4.16 },
  { rank: 41, name: "Max Verstappen", category: "Sports", wikiSlug: "Max_Verstappen", xHandle: "Max33Verstappen", status: "Active", totalVotes: 334, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 42, name: "KSI", category: "Creator", wikiSlug: "KSI", xHandle: "KSI", status: "Active", totalVotes: 332, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 43, name: "Giorgia Meloni", category: "Politics", wikiSlug: "Giorgia_Meloni", xHandle: "GiorgiaMeloni", status: "Active", totalVotes: 433, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 44, name: "Travis Scott", category: "Music", wikiSlug: "Travis_Scott", xHandle: "trvisXX", status: "Active", totalVotes: 572, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 45, name: "Vitalik Buterin", category: "Tech", wikiSlug: "Vitalik_Buterin", xHandle: "VitalikButerin", status: "Active", totalVotes: 194, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 46, name: "Mohammed bin Salman", category: "Politics", wikiSlug: "Mohammed_bin_Salman", xHandle: "", status: "Active", totalVotes: 740, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 47, name: "Khaby Lame", category: "Creator", wikiSlug: "Khaby_Lame", xHandle: "KhabyLame", status: "Active", totalVotes: 447, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 48, name: "Masayoshi Son", category: "Business", wikiSlug: "Masayoshi_Son", xHandle: "masason", status: "Active", totalVotes: 211, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 49, name: "Ariana Grande", category: "Music", wikiSlug: "Ariana_Grande", xHandle: "ArianaGrande", status: "Active", totalVotes: 900, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 50, name: "Neymar", category: "Sports", wikiSlug: "Neymar", xHandle: "neymarjr", status: "Active", totalVotes: 381, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 51, name: "Michael Dell", category: "Business", wikiSlug: "Michael_Dell", xHandle: "MichaelDell", status: "Active", totalVotes: 261, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 52, name: "Bill Ackman", category: "Business", wikiSlug: "Bill_Ackman", xHandle: "BillAckman", status: "Active", totalVotes: 309, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 53, name: "Billie Eilish", category: "Music", wikiSlug: "Billie_Eilish", xHandle: "billieeilish", status: "Active", totalVotes: 404, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 54, name: "Lex Fridman", category: "Creator", wikiSlug: "Lex_Fridman", xHandle: "lexfridman", status: "Active", totalVotes: 399, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 55, name: "Pony Ma", category: "Tech", wikiSlug: "Ma_Huateng", xHandle: "", status: "Active", totalVotes: 256, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 56, name: "Recep Tayyip Erdoğan", category: "Politics", wikiSlug: "Recep_Tayyip_Erdoğan", xHandle: "RTErdogan", status: "Active", totalVotes: 371, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 57, name: "Erling Haaland", category: "Sports", wikiSlug: "Erling_Haaland", xHandle: "ErlingHaaland", status: "Active", totalVotes: 539, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 58, name: "Palmer Luckey", category: "Tech", wikiSlug: "Palmer_Luckey", xHandle: "PalmerLuckey", status: "Active", totalVotes: 294, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 59, name: "Javier Milei", category: "Politics", wikiSlug: "Javier_Milei", xHandle: "JMilei", status: "Active", totalVotes: 381, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 60, name: "Lisa", category: "Music", wikiSlug: "Lisa_(rapper)", xHandle: "BLACKPINK", status: "Active", totalVotes: 216, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 61, name: "Conor McGregor", category: "Sports", wikiSlug: "Conor_McGregor", xHandle: "TheNotoriousMMA", status: "Active", totalVotes: 912, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 62, name: "Demis Hassabis", category: "Tech", wikiSlug: "Demis_Hassabis", xHandle: "demishassabis", status: "Active", totalVotes: 244, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 63, name: "Benjamin Netanyahu", category: "Politics", wikiSlug: "Benjamin_Netanyahu", xHandle: "netanyahu", status: "Active", totalVotes: 231, approvalPercent: 0.75, avgRating: 4.0 },
  { rank: 64, name: "Reed Hastings", category: "Business", wikiSlug: "Reed_Hastings", xHandle: "reedhastings", status: "Active", totalVotes: 305, approvalPercent: 0.76, avgRating: 4.04 },
  { rank: 65, name: "Alexandria Ocasio-Cortez", category: "Politics", wikiSlug: "Alexandria_Ocasio-Cortez", xHandle: "AOC", status: "Active", totalVotes: 385, approvalPercent: 0.71, avgRating: 3.84 },
  { rank: 66, name: "Ed Sheeran", category: "Music", wikiSlug: "Ed_Sheeran", xHandle: "edsheeran", status: "Active", totalVotes: 740, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 67, name: "Ursula von der Leyen", category: "Politics", wikiSlug: "Ursula_von_der_Leyen", xHandle: "vonderleyen", status: "Active", totalVotes: 185, approvalPercent: 0.71, avgRating: 3.84 },
  { rank: 68, name: "Novak Djokovic", category: "Sports", wikiSlug: "Novak_Djokovic", xHandle: "DjokerNole", status: "Active", totalVotes: 701, approvalPercent: 0.94, avgRating: 4.76 },
  { rank: 69, name: "Jake Paul", category: "Creator", wikiSlug: "Jake_Paul", xHandle: "jakepaul", status: "Active", totalVotes: 374, approvalPercent: 0.80, avgRating: 4.2 },
  { rank: 70, name: "Brian Armstrong", category: "Tech", wikiSlug: "Brian_Armstrong", xHandle: "brian_armstrong", status: "Active", totalVotes: 154, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 71, name: "Gavin Newsom", category: "Politics", wikiSlug: "Gavin_Newsom", xHandle: "GavinNewsom", status: "Active", totalVotes: 311, approvalPercent: 0.72, avgRating: 3.88 },
  { rank: 72, name: "Viktor Orbán", category: "Politics", wikiSlug: "Viktor_Orbán", xHandle: "PM_ViktorOrban", status: "Active", totalVotes: 152, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 73, name: "Rory McIlroy", category: "Sports", wikiSlug: "Rory_McIlroy", xHandle: "McIlroyRory", status: "Active", totalVotes: 457, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 74, name: "Tiger Woods", category: "Sports", wikiSlug: "Tiger_Woods", xHandle: "TigerWoods", status: "Active", totalVotes: 485, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 75, name: "Nicki Minaj", category: "Music", wikiSlug: "Nicki_Minaj", xHandle: "NICKIMINAJ", status: "Active", totalVotes: 348, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 76, name: "Adele", category: "Music", wikiSlug: "Adele", xHandle: "Adele", status: "Active", totalVotes: 317, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 77, name: "Tom Brady", category: "Sports", wikiSlug: "Tom_Brady", xHandle: "TomBrady", status: "Active", totalVotes: 340, approvalPercent: 0.93, avgRating: 4.72 },
  { rank: 78, name: "Tucker Carlson", category: "Creator", wikiSlug: "Tucker_Carlson", xHandle: "TuckerCarlson", status: "Active", totalVotes: 295, approvalPercent: 0.76, avgRating: 4.04 },
  { rank: 79, name: "Nayib Bukele", category: "Politics", wikiSlug: "Nayib_Bukele", xHandle: "nayibbukele", status: "Active", totalVotes: 435, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 80, name: "Chamath Palihapitiya", category: "Business", wikiSlug: "Chamath_Palihapitiya", xHandle: "chamath", status: "Active", totalVotes: 118, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 81, name: "David Sacks", category: "Business", wikiSlug: "David_Sacks", xHandle: "DavidSacks", status: "Active", totalVotes: 171, approvalPercent: 0.91, avgRating: 4.64 },
  { rank: 82, name: "Shayne Coplan", category: "Tech", wikiSlug: "Shayne_Coplan", xHandle: "shayne_coplan", status: "Active", totalVotes: 84, approvalPercent: 0.90, avgRating: 4.6 },
  { rank: 83, name: "Ray Dalio", category: "Business", wikiSlug: "Ray_Dalio", xHandle: "RayDalio", status: "Active", totalVotes: 154, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 84, name: "Peter Thiel", category: "Business", wikiSlug: "Peter_Thiel", xHandle: "peterthiel", status: "Active", totalVotes: 157, approvalPercent: 0.85, avgRating: 4.4 },
  { rank: 85, name: "Kash Patel", category: "Politics", wikiSlug: "Kash_Patel", xHandle: "Kash", status: "Active", totalVotes: 396, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 86, name: "Scott Bessent", category: "Business", wikiSlug: "Scott_Bessent", xHandle: "ScottBessent", status: "Active", totalVotes: 365, approvalPercent: 0.87, avgRating: 4.48 },
  { rank: 87, name: "Marco Rubio", category: "Politics", wikiSlug: "Marco_Rubio", xHandle: "marcorubio", status: "Active", totalVotes: 606, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 88, name: "JD Vance", category: "Politics", wikiSlug: "JD_Vance", xHandle: "JDVance", status: "Active", totalVotes: 715, approvalPercent: 0.86, avgRating: 4.44 },
  { rank: 89, name: "Pete Hegseth", category: "Politics", wikiSlug: "Pete_Hegseth", xHandle: "PeteHegseth", status: "Active", totalVotes: 342, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 90, name: "J.K. Rowling", category: "Creator", wikiSlug: "J._K._Rowling", xHandle: "jk_rowling", status: "Active", totalVotes: 542, approvalPercent: 0.82, avgRating: 4.28 },
  { rank: 91, name: "Scottie Scheffler", category: "Sports", wikiSlug: "Scottie_Scheffler", xHandle: "", status: "Active", totalVotes: 196, approvalPercent: 0.92, avgRating: 4.68 },
  { rank: 92, name: "Bryson DeChambeau", category: "Sports", wikiSlug: "Bryson_DeChambeau", xHandle: "b_dechambeau", status: "Active", totalVotes: 337, approvalPercent: 0.80, avgRating: 4.2 },
  { rank: 93, name: "Piers Morgan", category: "Creator", wikiSlug: "Piers_Morgan", xHandle: "piersmorgan", status: "Active", totalVotes: 775, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 94, name: "Nick Fuentes", category: "Politics", wikiSlug: "Nick_Fuentes", xHandle: "NickJFuentes", status: "Active", totalVotes: 112, approvalPercent: 0.62, avgRating: 3.48 },
  { rank: 95, name: "Changpeng Zhao", category: "Business", wikiSlug: "Changpeng_Zhao", xHandle: "", status: "Active", totalVotes: 367, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 96, name: "Robert F. Kennedy Jr.", category: "Politics", wikiSlug: "Robert_F._Kennedy_Jr.", xHandle: "RobertKennedyJr", status: "Active", totalVotes: 572, approvalPercent: 0.82, avgRating: 4.28 },
  { rank: 97, name: "Tulsi Gabbard", category: "Politics", wikiSlug: "Tulsi_Gabbard", xHandle: "TulsiGabbard", status: "Active", totalVotes: 538, approvalPercent: 0.80, avgRating: 4.2 },
  { rank: 98, name: "Karoline Leavitt", category: "Politics", wikiSlug: "Karoline_Leavitt", xHandle: "kleavittnh", status: "Active", totalVotes: 558, approvalPercent: 0.84, avgRating: 4.36 },
  { rank: 99, name: "Theo Von", category: "Creator", wikiSlug: "Theo_Von", xHandle: "TheoVon", status: "Active", totalVotes: 713, approvalPercent: 0.82, avgRating: 4.28 },
  { rank: 100, name: "Michael Saylor", category: "Tech", wikiSlug: "Michael_J._Saylor", xHandle: "saylor", status: "Active", totalVotes: 401, approvalPercent: 0.84, avgRating: 4.36 },
];

function generateVoteDistribution(targetAvg: number, totalVotes: number): number[] {
  const votes: number[] = [];
  
  if (targetAvg >= 4.5) {
    const fiveCount = Math.round(totalVotes * 0.75);
    const fourCount = Math.round(totalVotes * 0.20);
    const threeCount = totalVotes - fiveCount - fourCount;
    for (let i = 0; i < fiveCount; i++) votes.push(5);
    for (let i = 0; i < fourCount; i++) votes.push(4);
    for (let i = 0; i < threeCount; i++) votes.push(3);
  } else if (targetAvg >= 4.0) {
    const fiveCount = Math.round(totalVotes * 0.55);
    const fourCount = Math.round(totalVotes * 0.30);
    const threeCount = Math.round(totalVotes * 0.10);
    const twoCount = totalVotes - fiveCount - fourCount - threeCount;
    for (let i = 0; i < fiveCount; i++) votes.push(5);
    for (let i = 0; i < fourCount; i++) votes.push(4);
    for (let i = 0; i < threeCount; i++) votes.push(3);
    for (let i = 0; i < twoCount; i++) votes.push(2);
  } else if (targetAvg >= 3.5) {
    const fiveCount = Math.round(totalVotes * 0.35);
    const fourCount = Math.round(totalVotes * 0.25);
    const threeCount = Math.round(totalVotes * 0.20);
    const twoCount = Math.round(totalVotes * 0.15);
    const oneCount = totalVotes - fiveCount - fourCount - threeCount - twoCount;
    for (let i = 0; i < fiveCount; i++) votes.push(5);
    for (let i = 0; i < fourCount; i++) votes.push(4);
    for (let i = 0; i < threeCount; i++) votes.push(3);
    for (let i = 0; i < twoCount; i++) votes.push(2);
    for (let i = 0; i < oneCount; i++) votes.push(1);
  } else {
    const fiveCount = Math.round(totalVotes * 0.20);
    const fourCount = Math.round(totalVotes * 0.15);
    const threeCount = Math.round(totalVotes * 0.20);
    const twoCount = Math.round(totalVotes * 0.25);
    const oneCount = totalVotes - fiveCount - fourCount - threeCount - twoCount;
    for (let i = 0; i < fiveCount; i++) votes.push(5);
    for (let i = 0; i < fourCount; i++) votes.push(4);
    for (let i = 0; i < threeCount; i++) votes.push(3);
    for (let i = 0; i < twoCount; i++) votes.push(2);
    for (let i = 0; i < oneCount; i++) votes.push(1);
  }
  
  for (let i = votes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [votes[i], votes[j]] = [votes[j], votes[i]];
  }
  
  return votes;
}

export async function seedApprovalData(): Promise<{
  success: boolean;
  seeded: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let seeded = 0;
  let skipped = 0;

  console.log("[SeedApproval] Starting approval data seeding for", SEED_DATA.length, "celebrities...");

  for (const celebrity of SEED_DATA) {
    try {
      // Try manual mapping first
      const mappedName = NAME_MAPPING[celebrity.name] || celebrity.name;
      
      // First try exact case-insensitive match with mapped name
      let [tracked] = await db
        .select({ id: trackedPeople.id, name: trackedPeople.name })
        .from(trackedPeople)
        .where(sql`LOWER(${trackedPeople.name}) = LOWER(${mappedName})`)
        .limit(1);

      // If not found, try normalized fuzzy matching
      if (!tracked) {
        const normalizedSeedName = normalizeNameForMatch(celebrity.name);
        const allPeople = await db
          .select({ id: trackedPeople.id, name: trackedPeople.name })
          .from(trackedPeople);
        
        for (const person of allPeople) {
          const normalizedDbName = normalizeNameForMatch(person.name);
          if (normalizedDbName === normalizedSeedName || 
              normalizedDbName.includes(normalizedSeedName) || 
              normalizedSeedName.includes(normalizedDbName)) {
            tracked = person;
            console.log(`[SeedApproval] Fuzzy matched "${celebrity.name}" → "${person.name}"`);
            break;
          }
        }
      }

      if (!tracked) {
        console.log(`[SeedApproval] Celebrity not found in tracked_people: ${celebrity.name}`);
        skipped++;
        continue;
      }

      const personId = tracked.id;
      const personName = tracked.name;

      const { data: existingVotes, error: checkError } = await supabaseServer
        .from('user_votes')
        .select('id')
        .eq('user_id', SEED_USER_ID)
        .eq('person_id', personId)
        .limit(1);

      if (checkError) {
        console.error(`[SeedApproval] Error checking existing votes for ${personName}:`, checkError);
        errors.push(`${personName}: ${checkError.message}`);
        continue;
      }

      if (existingVotes && existingVotes.length > 0) {
        console.log(`[SeedApproval] Seed votes already exist for ${personName}, skipping...`);
        skipped++;
        continue;
      }

      const voteDistribution = generateVoteDistribution(celebrity.avgRating, celebrity.totalVotes);
      
      const voteRecords = voteDistribution.map((rating, index) => ({
        user_id: `${SEED_USER_ID}-${index}`,
        person_id: personId,
        person_name: personName,
        rating: rating,
      }));

      const batchSize = 500;
      for (let i = 0; i < voteRecords.length; i += batchSize) {
        const batch = voteRecords.slice(i, i + batchSize);
        const { error: insertError } = await supabaseServer
          .from('user_votes')
          .upsert(batch, { onConflict: 'user_id,person_id' });

        if (insertError) {
          console.error(`[SeedApproval] Error inserting votes for ${personName} batch ${i}:`, insertError);
          errors.push(`${personName}: ${insertError.message}`);
          break;
        }
      }

      const { data: allVotes, error: sumError } = await supabaseServer
        .from('user_votes')
        .select('rating')
        .eq('person_id', personId);

      if (!sumError && allVotes && allVotes.length > 0) {
        const votesCount = allVotes.length;
        const sum = allVotes.reduce((acc, v) => acc + v.rating, 0);
        const avgRating = sum / votesCount;
        const approvalPct = Math.round(((avgRating - 1) / 4) * 100);

        const [trendData] = await db
          .select({ trendScore: trendingPeople.trendScore, fameIndex: trendingPeople.fameIndex })
          .from(trendingPeople)
          .where(eq(trendingPeople.id, personId))
          .limit(1);

        await db
          .insert(celebrityMetrics)
          .values({
            celebrityId: personId,
            trendScore: trendData?.trendScore || null,
            fameIndex: trendData?.fameIndex || null,
            approvalVotesCount: votesCount,
            approvalAvgRating: avgRating,
            approvalPct: approvalPct,
            underratedVotesCount: 0,
            overratedVotesCount: 0,
          })
          .onConflictDoUpdate({
            target: celebrityMetrics.celebrityId,
            set: {
              approvalVotesCount: votesCount,
              approvalAvgRating: avgRating,
              approvalPct: approvalPct,
              updatedAt: new Date(),
            },
          });

        console.log(`[SeedApproval] Seeded ${personName}: ${votesCount} votes, avg ${avgRating.toFixed(2)}, approval ${approvalPct}%`);
        seeded++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SeedApproval] Error processing ${celebrity.name}:`, message);
      errors.push(`${celebrity.name}: ${message}`);
    }
  }

  console.log(`[SeedApproval] Completed. Seeded: ${seeded}, Skipped: ${skipped}, Errors: ${errors.length}`);

  return {
    success: errors.length === 0,
    seeded,
    skipped,
    errors,
  };
}

/**
 * Fast direct seeding - inserts directly into celebrity_metrics without creating votes.
 * This is faster and more reliable than the vote-based seeding.
 */
export async function seedApprovalDataDirect(): Promise<{
  success: boolean;
  seeded: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let seeded = 0;
  let skipped = 0;

  console.log("[SeedApprovalDirect] Starting direct approval data seeding for", SEED_DATA.length, "celebrities...");

  for (const celebrity of SEED_DATA) {
    try {
      // Try manual mapping first
      const mappedName = NAME_MAPPING[celebrity.name] || celebrity.name;
      
      // First try exact case-insensitive match with mapped name
      let tracked: { id: string; name: string } | undefined = (await db
        .select({ id: trackedPeople.id, name: trackedPeople.name })
        .from(trackedPeople)
        .where(sql`LOWER(${trackedPeople.name}) = LOWER(${mappedName})`)
        .limit(1))[0];

      // If not found by name, try deterministic wikiSlug lookup
      if (!tracked && celebrity.wikiSlug) {
        const [bySlug] = await db
          .select({ id: trackedPeople.id, name: trackedPeople.name })
          .from(trackedPeople)
          .where(sql`${trackedPeople.wikiSlug} = ${celebrity.wikiSlug}`)
          .limit(1);
        
        if (bySlug) {
          tracked = bySlug;
          console.log(`[SeedApprovalDirect] Matched by wikiSlug "${celebrity.wikiSlug}" → "${bySlug.name}"`);
        }
      }

      // If still not found, try normalized fuzzy matching as last resort
      if (!tracked) {
        const normalizedSeedName = normalizeNameForMatch(celebrity.name);
        const allPeople = await db
          .select({ id: trackedPeople.id, name: trackedPeople.name })
          .from(trackedPeople);
        
        for (const person of allPeople) {
          const normalizedDbName = normalizeNameForMatch(person.name);
          if (normalizedDbName === normalizedSeedName || 
              normalizedDbName.includes(normalizedSeedName) || 
              normalizedSeedName.includes(normalizedDbName)) {
            tracked = person;
            console.log(`[SeedApprovalDirect] Fuzzy matched "${celebrity.name}" → "${person.name}"`);
            break;
          }
        }
      }

      if (!tracked) {
        console.log(`[SeedApprovalDirect] Celebrity not found in tracked_people: ${celebrity.name}`);
        errors.push(`Not found: ${celebrity.name}`);
        continue;
      }

      const personId = tracked.id;

      // Get trend data
      const [trendData] = await db
        .select({ trendScore: trendingPeople.trendScore, fameIndex: trendingPeople.fameIndex })
        .from(trendingPeople)
        .where(eq(trendingPeople.id, personId))
        .limit(1);

      // Convert fractional approval to percentage
      const approvalPct = celebrity.approvalPercent <= 1 
        ? Math.round(celebrity.approvalPercent * 100) 
        : Math.round(celebrity.approvalPercent);

      // Direct insert into celebrity_metrics
      await db
        .insert(celebrityMetrics)
        .values({
          celebrityId: personId,
          trendScore: trendData?.trendScore || null,
          fameIndex: trendData?.fameIndex || null,
          approvalVotesCount: celebrity.totalVotes,
          approvalAvgRating: celebrity.avgRating,
          approvalPct: approvalPct,
          underratedVotesCount: 0,
          overratedVotesCount: 0,
        })
        .onConflictDoUpdate({
          target: celebrityMetrics.celebrityId,
          set: {
            approvalVotesCount: celebrity.totalVotes,
            approvalAvgRating: celebrity.avgRating,
            approvalPct: approvalPct,
            updatedAt: new Date(),
          },
        });

      console.log(`[SeedApprovalDirect] Seeded ${tracked.name}: ${celebrity.totalVotes} votes, approval ${approvalPct}%`);
      seeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SeedApprovalDirect] Error processing ${celebrity.name}:`, message);
      errors.push(`${celebrity.name}: ${message}`);
    }
  }

  // Validate final count
  const [countResult] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(celebrityMetrics)
    .where(sql`${celebrityMetrics.approvalPct} IS NOT NULL AND ${celebrityMetrics.approvalVotesCount} > 0`);
  
  const finalCount = Number(countResult?.count) || 0;
  console.log(`[SeedApprovalDirect] Completed. Seeded: ${seeded}, Errors: ${errors.length}, Total in DB: ${finalCount}/${SEED_DATA.length}`);
  
  // Log missing celebrities for actionable feedback
  if (errors.length > 0) {
    console.error(`[SeedApprovalDirect] Missing celebrities (${errors.length}):`);
    errors.forEach(err => console.error(`  - ${err}`));
  }

  // Fail hard if we didn't seed all celebrities
  if (finalCount < SEED_DATA.length) {
    const errorMsg = `SEED FAILED: Only ${finalCount}/${SEED_DATA.length} celebrities have approval data. Missing: ${errors.join(', ')}`;
    console.error(`[SeedApprovalDirect] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  return {
    success: errors.length === 0,
    seeded,
    skipped,
    errors,
  };
}

export async function clearSeedApprovalData(): Promise<{
  success: boolean;
  deleted: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabaseServer
      .from('user_votes')
      .delete()
      .like('user_id', `${SEED_USER_ID}%`);

    if (error) {
      return { success: false, deleted: 0, error: error.message };
    }

    console.log("[SeedApproval] Cleared all seed approval data");
    return { success: true, deleted: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, deleted: 0, error: message };
  }
}
