import { db } from "./db";
import { communityInsights, insightVotes, trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedCommunityInsights() {
  try {
    console.log("🌱 Seeding community insights...");

    // Get Elon Musk from the database (first person in our list)
    const [elonMusk] = await db
      .select()
      .from(trackedPeople)
      .where(eq(trackedPeople.name, "Elon Musk"))
      .limit(1);

    if (!elonMusk) {
      console.log("❌ Elon Musk not found in database, skipping community insights seed");
      return;
    }

    // Mock user IDs (simulating different Supabase users)
    const mockUsers = [
      { id: "user-001", username: "techfan2024" },
      { id: "user-002", username: "marketwatcher" },
      { id: "user-003", username: "innovationlover" },
      { id: "user-004", username: "skeptic_mike" },
      { id: "user-005", username: "futurist99" },
    ];

    // Delete existing insights for Elon Musk (for clean re-seeding)
    await db
      .delete(communityInsights)
      .where(eq(communityInsights.personId, elonMusk.id));

    console.log("Creating community insights...");

    // Create 5 mock insights with varying content
    const insights = [
      {
        content: "His work with SpaceX is genuinely revolutionary. Making space travel reusable has changed the entire industry's economics. Regardless of opinions on other ventures, the engineering achievements here are undeniable.",
        userId: mockUsers[0].id,
        username: mockUsers[0].username,
      },
      {
        content: "The Tesla Cybertruck design is polarizing, but you can't deny the innovation in electric vehicle tech. The 4680 battery cells and structural battery pack are engineering marvels that will influence the entire EV industry.",
        userId: mockUsers[1].id,
        username: mockUsers[1].username,
      },
      {
        content: "While I admire the ambition, some of the timelines promised vs. delivered tell a different story. Full Self-Driving has been \"next year\" for almost a decade now. Important to separate the vision from current reality.",
        userId: mockUsers[3].id,
        username: mockUsers[3].username,
      },
      {
        content: "Neuralink could be transformative for people with paralysis and neurological conditions. The brain-computer interface progress is exciting, though we need to watch the ethics carefully as it develops.",
        userId: mockUsers[4].id,
        username: mockUsers[4].username,
      },
      {
        content: "Love him or hate him, the man moves fast and takes big swings. Not all of them work out, but that's kind of the point with innovation. The Starship development pace is insane compared to traditional aerospace.",
        userId: mockUsers[2].id,
        username: mockUsers[2].username,
      },
    ];

    const createdInsights = [];
    for (const insight of insights) {
      const [created] = await db
        .insert(communityInsights)
        .values({
          personId: elonMusk.id,
          userId: insight.userId,
          username: insight.username,
          content: insight.content,
        })
        .returning();
      createdInsights.push(created);
    }

    console.log(`✅ Created ${createdInsights.length} insights`);

    // Add votes to create varying vote counts
    // Insight 1: Very popular (120 net votes) - Top post
    await createVotes(createdInsights[0].id, 150, 30);

    // Insight 2: Moderately popular (45 net votes)
    await createVotes(createdInsights[1].id, 60, 15);

    // Insight 3: Controversial (-12 net votes)
    await createVotes(createdInsights[2].id, 25, 37);

    // Insight 4: Positive (32 net votes)
    await createVotes(createdInsights[3].id, 50, 18);

    // Insight 5: Mixed (8 net votes)
    await createVotes(createdInsights[4].id, 35, 27);

    console.log("✅ Community insights seeded successfully!");
  } catch (error) {
    console.error("❌ Error seeding community insights:", error);
  }
}

// Helper function to create votes
async function createVotes(insightId: string, upvoteCount: number, downvoteCount: number) {
  const votePromises = [];

  // Create upvotes
  for (let i = 0; i < upvoteCount; i++) {
    votePromises.push(
      db.insert(insightVotes).values({
        insightId,
        userId: `voter-up-${i}`,
        voteType: "up",
      })
    );
  }

  // Create downvotes
  for (let i = 0; i < downvoteCount; i++) {
    votePromises.push(
      db.insert(insightVotes).values({
        insightId,
        userId: `voter-down-${i}`,
        voteType: "down",
      })
    );
  }

  await Promise.all(votePromises);
  console.log(`  Added ${upvoteCount} upvotes and ${downvoteCount} downvotes to insight`);
}

// Only run if executed directly via tsx
if (import.meta.url === `file://${process.argv[1]}`) {
  seedCommunityInsights()
    .then(() => {
      console.log("✨ Seeding complete!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Seeding failed:", error);
      process.exit(1);
    });
}
