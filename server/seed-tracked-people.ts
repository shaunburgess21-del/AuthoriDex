import { db } from "./db";
import { trackedPeople } from "@shared/schema";

// Top 100 most trending people across all categories (2025)
// Based on research from TIME 100, Forbes, Rolling Stone, and other authoritative sources
const TOP_100_PEOPLE = [
  // Social Media Creators & Influencers (25)
  { name: "Kai Cenat", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KaiCenat" },
  { name: "MrBeast", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MrBeast" },
  { name: "Khaby Lame", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KhabyLame" },
  { name: "Alix Earle", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AlixEarle" },
  { name: "Charli D'Amelio", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CharliDAmelio" },
  { name: "Logan Paul", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LoganPaul" },
  { name: "Jake Paul", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JakePaul" },
  { name: "PewDiePie", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PewDiePie" },
  { name: "Pokimane", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Pokimane" },
  { name: "Keith Lee", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KeithLee" },
  { name: "Sean Evans", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SeanEvans" },
  { name: "Theo Von", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=TheoVon" },
  { name: "Dave Portnoy", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DavePortnoy" },
  { name: "Lilly Singh", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LillySingh" },
  { name: "Livvy Dunne", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LivvyDunne" },
  { name: "Quenlin Blackwell", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=QuenlinBlackwell" },
  { name: "Lele Pons", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LelePons" },
  { name: "Druski", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Druski" },
  { name: "Brittany Broski", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=BrittanyBroski" },
  { name: "Rachel Sennott", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=RachelSennott" },
  { name: "Meredith Hayden", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MeredithHayden" },
  { name: "Alan Chikin Chow", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AlanChikinChow" },
  { name: "Jannat Zubair", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JannatZubair" },
  { name: "Virginia", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Virginia" },
  { name: "Kay Poyer", category: "Creator", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KayPoyer" },
  
  // Traditional Celebrities (20)
  { name: "Cristiano Ronaldo", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CristianoRonaldo" },
  { name: "Lionel Messi", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LionelMessi" },
  { name: "Selena Gomez", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SelenaGomez" },
  { name: "Kim Kardashian", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KimKardashian" },
  { name: "Kylie Jenner", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KylieJenner" },
  { name: "Rihanna", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Rihanna" },
  { name: "Beyoncé", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Beyonce" },
  { name: "Taylor Swift", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=TaylorSwift" },
  { name: "Ariana Grande", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ArianaGrande" },
  { name: "Justin Timberlake", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JustinTimberlake" },
  { name: "Cardi B", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CardiB" },
  { name: "Nicki Minaj", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=NickiMinaj" },
  { name: "Chris Brown", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ChrisBrown" },
  { name: "Ed Sheeran", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=EdSheeran" },
  { name: "Ryan Reynolds", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=RyanReynolds" },
  { name: "Dwayne Johnson", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DwayneJohnson" },
  { name: "Sebastian Stan", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SebastianStan" },
  { name: "Jeremy Allen White", category: "Entertainment", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JeremyAllenWhite" },
  { name: "Charli XCX", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CharliXCX" },
  { name: "PinkPantheress", category: "Music", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PinkPantheress" },

  // Tech & Business Leaders (20)
  { name: "Elon Musk", category: "Tech", avatar: "/attached_assets/elon-musk.png" },
  { name: "Jensen Huang", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JensenHuang" },
  { name: "Mark Zuckerberg", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MarkZuckerberg" },
  { name: "Satya Nadella", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SatyaNadella" },
  { name: "Sundar Pichai", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SundarPichai" },
  { name: "Tim Cook", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=TimCook" },
  { name: "Sam Altman", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SamAltman" },
  { name: "Jack Ma", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JackMa" },
  { name: "Pony Ma", category: "Tech", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PonyMa" },
  { name: "Mary Barra", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MaryBarra" },
  { name: "Mark Cuban", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MarkCuban" },
  { name: "Sheryl Sandberg", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SherylSandberg" },
  { name: "Arianna Huffington", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AriannaHuffington" },
  { name: "Tony Robbins", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=TonyRobbins" },
  { name: "Reshma Saujani", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ReshmaSaujani" },
  { name: "Duncan Wardle", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DuncanWardle" },
  { name: "Karren Brady", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KarrenBrady" },
  { name: "Piers Linney", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PiersLinney" },
  { name: "Matthew Syed", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MatthewSyed" },
  { name: "Amy Edmondson", category: "Business", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AmyEdmondson" },

  // Politicians & World Leaders (15)
  { name: "Donald Trump", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DonaldTrump" },
  { name: "Narendra Modi", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=NarendraModi" },
  { name: "Xi Jinping", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=XiJinping" },
  { name: "Vladimir Putin", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=VladimirPutin" },
  { name: "Claudia Sheinbaum", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ClaudiaSheinbaum" },
  { name: "Mark Carney", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MarkCarney" },
  { name: "Bernie Sanders", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=BernieSanders" },
  { name: "Emmanuel Macron", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=EmmanuelMacron" },
  { name: "Keir Starmer", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KeirStarmer" },
  { name: "Mike Johnson", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=MikeJohnson" },
  { name: "Hakeem Jeffries", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=HakeemJeffries" },
  { name: "Sarah McBride", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SarahMcBride" },
  { name: "Andy Kim", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AndyKim" },
  { name: "Prabowo Subianto", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=PrabowoSubianto" },
  { name: "Cyril Ramaphosa", category: "Politics", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CyrilRamaphosa" },

  // Athletes (20)
  { name: "LeBron James", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=LeBronJames" },
  { name: "Stephen Curry", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=StephenCurry" },
  { name: "Kylian Mbappé", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KylianMbappe" },
  { name: "Neymar", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Neymar" },
  { name: "Giannis Antetokounmpo", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=GiannisAntetokounmpo" },
  { name: "Anthony Edwards", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=AnthonyEdwards" },
  { name: "Jayson Tatum", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JaysonTatum" },
  { name: "Victor Wembanyama", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=VictorWembanyama" },
  { name: "Jalen Hurts", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JalenHurts" },
  { name: "Dak Prescott", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=DakPrescott" },
  { name: "Saquon Barkley", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SaquonBarkley" },
  { name: "Shohei Ohtani", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ShoheiOhtani" },
  { name: "Juan Soto", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=JuanSoto" },
  { name: "Kevin Durant", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KevinDurant" },
  { name: "Karim Benzema", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=KarimBenzema" },
  { name: "Sachin Tendulkar", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SachinTendulkar" },
  { name: "Tyson Fury", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=TysonFury" },
  { name: "Serena Williams", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SerenaWilliams" },
  { name: "Simone Biles", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=SimoneBiles" },
  { name: "Naomi Osaka", category: "Sports", avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=NaomiOsaka" },
];

export async function seedTrackedPeople() {
  console.log("🌱 Seeding tracked people...");
  
  try {
    // Clear existing data
    await db.delete(trackedPeople);
    
    // Insert all 100 people
    const inserted = await db.insert(trackedPeople).values(TOP_100_PEOPLE).returning();
    
    console.log(`✅ Successfully seeded ${inserted.length} tracked people`);
    return inserted;
  } catch (error) {
    console.error("❌ Error seeding tracked people:", error);
    throw error;
  }
}

// Run if executed directly (ES modules)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  seedTrackedPeople()
    .then(() => {
      console.log("✨ Seeding complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Seeding failed:", error);
      process.exit(1);
    });
}
