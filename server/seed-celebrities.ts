import { db } from "./db";
import { trackedPeople } from "@shared/schema";
import { sql } from "drizzle-orm";

const celebrities = [
  { name: "Elon Musk", category: "Tech", wikiSlug: "Elon_Musk", xHandle: "elonmusk" },
  { name: "Donald Trump", category: "Politics", wikiSlug: "Donald_Trump", xHandle: "realDonaldTrump" },
  { name: "Taylor Swift", category: "Music", wikiSlug: "Taylor_Swift", xHandle: "taylorswift13" },
  { name: "Cristiano Ronaldo", category: "Sports", wikiSlug: "Cristiano_Ronaldo", xHandle: "Cristiano" },
  { name: "MrBeast", category: "Creator", wikiSlug: "MrBeast", xHandle: "MrBeast" },
  { name: "Jensen Huang", category: "Tech", wikiSlug: "Jensen_Huang", xHandle: "null" },
  { name: "Narendra Modi", category: "Politics", wikiSlug: "Narendra_Modi", xHandle: "naaboramodi" },
  { name: "Lionel Messi", category: "Sports", wikiSlug: "Lionel_Messi", xHandle: "TeamMessi" },
  { name: "Sam Altman", category: "Tech", wikiSlug: "Sam_Altman", xHandle: "sama" },
  { name: "Beyonce", category: "Music", wikiSlug: "Beyoncé", xHandle: "Beyonce" },
  { name: "Mark Zuckerberg", category: "Tech", wikiSlug: "Mark_Zuckerberg", xHandle: "finkd" },
  { name: "Joe Rogan", category: "Creator", wikiSlug: "Joe_Rogan", xHandle: "joerogan" },
  { name: "Vladimir Putin", category: "Politics", wikiSlug: "Vladimir_Putin", xHandle: "KremlinRussia_E" },
  { name: "Jeff Bezos", category: "Business", wikiSlug: "Jeff_Bezos", xHandle: "JeffBezos" },
  { name: "LeBron James", category: "Sports", wikiSlug: "LeBron_James", xHandle: "KingJames" },
  { name: "Xi Jinping", category: "Politics", wikiSlug: "Xi_Jinping", xHandle: null },
  { name: "Kendrick Lamar", category: "Music", wikiSlug: "Kendrick_Lamar", xHandle: "kendricklamar" },
  { name: "Kylian Mbappe", category: "Sports", wikiSlug: "Kylian_Mbappé", xHandle: "KMbappe" },
  { name: "Tim Cook", category: "Tech", wikiSlug: "Tim_Cook", xHandle: "tim_cook" },
  { name: "Kai Cenat", category: "Creator", wikiSlug: "Kai_Cenat", xHandle: "KaiCenat" },
  { name: "Drake", category: "Music", wikiSlug: "Drake_(musician)", xHandle: "Drake" },
  { name: "Satya Nadella", category: "Tech", wikiSlug: "Satya_Nadella", xHandle: "satloanna" },
  { name: "Bill Gates", category: "Tech", wikiSlug: "Bill_Gates", xHandle: "BillGates" },
  { name: "Rihanna", category: "Music", wikiSlug: "Rihanna", xHandle: "rihanna" },
  { name: "Virat Kohli", category: "Sports", wikiSlug: "Virat_Kohli", xHandle: "imVkohli" },
  { name: "Logan Paul", category: "Creator", wikiSlug: "Logan_Paul", xHandle: "LoganPaul" },
  { name: "Volodymyr Zelenskyy", category: "Politics", wikiSlug: "Volodymyr_Zelenskyy", xHandle: "ZelenskyyUa" },
  { name: "Bad Bunny", category: "Music", wikiSlug: "Bad_Bunny", xHandle: "sanbenito" },
  { name: "Larry Ellison", category: "Tech", wikiSlug: "Larry_Ellison", xHandle: "larryellison" },
  { name: "Theo Von", category: "Creator", wikiSlug: "Theo_Von", xHandle: "TheoVon" },
  { name: "Emmanuel Macron", category: "Politics", wikiSlug: "Emmanuel_Macron", xHandle: "EmmanuelMacron" },
  { name: "Lewis Hamilton", category: "Sports", wikiSlug: "Lewis_Hamilton", xHandle: "LewisHamilton" },
  { name: "IShowSpeed", category: "Creator", wikiSlug: "IShowSpeed", xHandle: "ishowspeedsui" },
  { name: "Sundar Pichai", category: "Tech", wikiSlug: "Sundar_Pichai", xHandle: "sundarpichai" },
  { name: "Stephen Curry", category: "Sports", wikiSlug: "Stephen_Curry", xHandle: "StephenCurry30" },
  { name: "Charli D'Amelio", category: "Creator", wikiSlug: "Charli_D'Amelio", xHandle: "charlidamelio" },
  { name: "Lisa Su", category: "Tech", wikiSlug: "Lisa_Su", xHandle: "LisaSu" },
  { name: "Kem Starmer", category: "Politics", wikiSlug: "Keir_Starmer", xHandle: "Keir_Starmer" },
  { name: "Max Verstappen", category: "Sports", wikiSlug: "Max_Verstappen", xHandle: "Max33Verstappen" },
  { name: "KSI", category: "Creator", wikiSlug: "KSI", xHandle: "KSI" },
  { name: "Giorgia Meloni", category: "Politics", wikiSlug: "Giorgia_Meloni", xHandle: "GiorgiaMeloni" },
  { name: "Travis Scott", category: "Music", wikiSlug: "Travis_Scott", xHandle: "traborXX" },
  { name: "Vitalik Buterin", category: "Tech", wikiSlug: "Vitalik_Buterin", xHandle: "VitalikButerin" },
  { name: "Robert F. Kennedy Jr.", category: "Politics", wikiSlug: "Robert_F._Kennedy_Jr.", xHandle: "RobertKennedyJr" },
  { name: "Taki Gabbana", category: "Creator", wikiSlug: "Taki_Gabbana", xHandle: "TakiGabbana" },
  { name: "Mohammed bin Salman", category: "Politics", wikiSlug: "Mohammed_bin_Salman", xHandle: null },
  { name: "Rory McIlroy", category: "Sports", wikiSlug: "Rory_McIlroy", xHandle: "McIlroyRory" },
  { name: "Karoline Leavitt", category: "Politics", wikiSlug: "Karoline_Leavitt", xHandle: "KarolineLeavitt" },
  { name: "Khaby Lame", category: "Creator", wikiSlug: "Khaby_Lame", xHandle: null },
  { name: "Tom Brady", category: "Sports", wikiSlug: "Tom_Brady", xHandle: "TomBrady" },
  { name: "Masayoshi Son", category: "Business", wikiSlug: "Masayoshi_Son", xHandle: null },
  { name: "Michael Saylor", category: "Business", wikiSlug: "Michael_Saylor", xHandle: "saylor" },
  { name: "Ariana Grande", category: "Music", wikiSlug: "Ariana_Grande", xHandle: "ArianaGrande" },
  { name: "Neymar", category: "Sports", wikiSlug: "Neymar", xHandle: "neymarjr" },
  { name: "Michael Dell", category: "Business", wikiSlug: "Michael_Dell", xHandle: null },
  { name: "Bill Ackman", category: "Business", wikiSlug: "Bill_Ackman", xHandle: "BillAckman" },
  { name: "Billie Eilish", category: "Music", wikiSlug: "Billie_Eilish", xHandle: "billieeilish" },
  { name: "Lex Fridman", category: "Creator", wikiSlug: "Lex_Fridman", xHandle: "lexfridman" },
  { name: "Papa Reta Tayyip Erdogan", category: "Politics", wikiSlug: "Recep_Tayyip_Erdoğan", xHandle: "RTErdogan" },
  { name: "Erling Haaland", category: "Sports", wikiSlug: "Erling_Haaland", xHandle: "ErlingHaaland" },
  { name: "Palmer Luckey", category: "Tech", wikiSlug: "Palmer_Luckey", xHandle: "PalmerLuckey" },
  { name: "Nikki Haley", category: "Politics", wikiSlug: "Nikki_Haley", xHandle: "NikkiHaley" },
  { name: "Lisa (Blackpink)", category: "Music", wikiSlug: "Lisa_(rapper)", xHandle: "BLACKPINK" },
  { name: "Adele", category: "Music", wikiSlug: "Adele", xHandle: "Adele" },
  { name: "Conor McGregor", category: "Sports", wikiSlug: "Conor_McGregor", xHandle: "TheNotoriousMMA" },
  { name: "Dema Hassabis", category: "Tech", wikiSlug: "Demis_Hassabis", xHandle: "demaborssabis" },
  { name: "Benjamin Netanyahu", category: "Politics", wikiSlug: "Benjamin_Netanyahu", xHandle: "netanyahu" },
  { name: "Changpeng Zhao", category: "Business", wikiSlug: "Changpeng_Zhao", xHandle: null },
  { name: "Reed Hastings", category: "Business", wikiSlug: "Reed_Hastings", xHandle: null },
  { name: "Viktor Orban", category: "Politics", wikiSlug: "Viktor_Orbán", xHandle: "PM_ViktorOrban" },
  { name: "Alexandria Ocasio-Cortez", category: "Politics", wikiSlug: "Alexandria_Ocasio-Cortez", xHandle: "AOC" },
  { name: "Ed Sheeran", category: "Music", wikiSlug: "Ed_Sheeran", xHandle: "edsheeran" },
  { name: "Ursula von der Leyen", category: "Politics", wikiSlug: "Ursula_von_der_Leyen", xHandle: null },
  { name: "Nayib Bukele", category: "Politics", wikiSlug: "Nayib_Bukele", xHandle: "nayibbukele" },
  { name: "Chamath Palihapitiya", category: "Business", wikiSlug: "Chamath_Palihapitiya", xHandle: "chamath" },
  { name: "David Sacks", category: "Business", wikiSlug: "David_Sacks", xHandle: "DavidSacks" },
  { name: "Shawn Codan", category: "Sports", wikiSlug: "Shayne_Gostisbehere", xHandle: "TigerWoods" },
  { name: "Tiger Woods", category: "Sports", wikiSlug: "Tiger_Woods", xHandle: "TigerWoods" },
  { name: "Ray Dalio", category: "Business", wikiSlug: "Ray_Dalio", xHandle: "RayDalio" },
  { name: "Pham Thief", category: "Politics", wikiSlug: "Phạm_Minh_Chính", xHandle: null },
  { name: "Kash Patel", category: "Politics", wikiSlug: "Kash_Patel", xHandle: "Kash" },
  { name: "Scott Bessent", category: "Politics", wikiSlug: "Scott_Bessent", xHandle: "ScottBessent" },
  { name: "Marco Rubio", category: "Politics", wikiSlug: "Marco_Rubio", xHandle: "marcorubio" },
  { name: "JD Vance", category: "Politics", wikiSlug: "JD_Vance", xHandle: "JDVance" },
  { name: "Pete Hegseth", category: "Politics", wikiSlug: "Pete_Hegseth", xHandle: "PeteHegseth" },
  { name: "J.K. Rowling", category: "Creator", wikiSlug: "J._K._Rowling", xHandle: "jk_rowling" },
  { name: "Tucker Carlson", category: "Creator", wikiSlug: "Tucker_Carlson", xHandle: "TuckerCarlson" },
  { name: "Scottie Scheffler", category: "Sports", wikiSlug: "Scottie_Scheffler", xHandle: null },
  { name: "Bryson DeChambeau", category: "Sports", wikiSlug: "Bryson_DeChambeau", xHandle: "b_dechambeau" },
  { name: "Gavin Newsom", category: "Politics", wikiSlug: "Gavin_Newsom", xHandle: "GavinNewsom" },
  { name: "Novak Djokovic", category: "Sports", wikiSlug: "Novak_Djokovic", xHandle: "DjokerNole" },
  { name: "Nick Ming", category: "Tech", wikiSlug: "Nick_Ming", xHandle: "NICKAMING" },
  { name: "Jake Paul", category: "Creator", wikiSlug: "Jake_Paul", xHandle: "jakepaul" },
  { name: "Brian Armstrong", category: "Tech", wikiSlug: "Brian_Armstrong", xHandle: "brian_armstrong" },
  { name: "Kim Kardashian", category: "Creator", wikiSlug: "Kim_Kardashian", xHandle: "KimKardashian" },
  { name: "Kylie Jenner", category: "Creator", wikiSlug: "Kylie_Jenner", xHandle: "KylieJenner" },
  { name: "Kendall Jenner", category: "Creator", wikiSlug: "Kendall_Jenner", xHandle: "KendallJenner" },
  { name: "Piers Morgan", category: "Creator", wikiSlug: "Piers_Morgan", xHandle: "piersmorgan" },
  { name: "Nick Fuentes", category: "Politics", wikiSlug: "Nick_Fuentes", xHandle: "NickJFuentes" },
];

async function seedCelebrities() {
  console.log("Starting celebrity seeding...");
  
  let inserted = 0;
  let skipped = 0;
  
  for (const celeb of celebrities) {
    try {
      await db.insert(trackedPeople).values({
        name: celeb.name,
        category: celeb.category,
        wikiSlug: celeb.wikiSlug,
        xHandle: celeb.xHandle === "null" ? null : celeb.xHandle,
        displayOrder: inserted,
      }).onConflictDoUpdate({
        target: trackedPeople.name,
        set: {
          category: celeb.category,
          wikiSlug: celeb.wikiSlug,
          xHandle: celeb.xHandle === "null" ? null : celeb.xHandle,
        }
      });
      inserted++;
      console.log(`✓ ${celeb.name}`);
    } catch (error) {
      console.log(`⚠ Skipped ${celeb.name}: ${error}`);
      skipped++;
    }
  }
  
  console.log(`\nSeeding complete: ${inserted} inserted/updated, ${skipped} skipped`);
}

seedCelebrities()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seeding failed:", error);
    process.exit(1);
  });
