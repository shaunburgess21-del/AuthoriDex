/**
 * One-time seeder: creates 6 real Supabase Auth accounts + profiles + agent_configs.
 * Uses service-role key to bypass RLS and email confirmation.
 * Run via admin route or directly: npx tsx server/agents/agentSeeder.ts
 */

import { supabaseServer } from "../supabase";
import { db } from "../db";
import { profiles, agentConfigs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { log } from "../log";

const AGENT_SEEDS = [
  {
    username: "trendrider_za",
    displayName: "TrendRider_ZA",
    bio: "Chasing momentum. If the trend score is climbing, I'm in.",
    archetype: "momentum_chaser",
    specialties: ["music", "creator", "entertainment"],
    boldness: 0.8,
    contrarianism: 0.15,
    recencyWeight: 0.9,
    prestigeBias: 0.35,
    confidenceCal: 0.72,
    riskAppetite: 0.3,
    consensusSensitivity: 0.45,
    activityRate: 0.7,
    daysAgo: 78,
  },
  {
    username: "oldguard_analyst",
    displayName: "OldGuard_Analyst",
    bio: "Legacy speaks louder than last week's spike.",
    archetype: "prestige_maximiser",
    specialties: ["entertainment", "politics", "business", "sports"],
    boldness: 0.45,
    contrarianism: 0.2,
    recencyWeight: 0.25,
    prestigeBias: 0.9,
    confidenceCal: 0.65,
    riskAppetite: 0.55,
    consensusSensitivity: 0.35,
    activityRate: 0.45,
    daysAgo: 62,
  },
  {
    username: "fadeking_official",
    displayName: "FadeKing",
    bio: "The crowd is always wrong at the extremes. Always.",
    archetype: "contrarian",
    specialties: ["sports", "entertainment", "creator"],
    boldness: 0.65,
    contrarianism: 0.88,
    recencyWeight: 0.5,
    prestigeBias: 0.3,
    confidenceCal: 0.6,
    riskAppetite: 0.5,
    consensusSensitivity: 0.9,
    activityRate: 0.55,
    daysAgo: 45,
  },
  {
    username: "pulsescout",
    displayName: "PulseScout",
    bio: "News is signal. Everything else is noise.",
    archetype: "news_reactive",
    specialties: ["politics", "business", "sports", "tech"],
    boldness: 0.7,
    contrarianism: 0.3,
    recencyWeight: 0.75,
    prestigeBias: 0.5,
    confidenceCal: 0.68,
    riskAppetite: 0.4,
    consensusSensitivity: 0.4,
    activityRate: 0.65,
    daysAgo: 55,
  },
  {
    username: "culturedeep",
    displayName: "CultureDeep",
    bio: "Slow calls. Strong conviction. I don't chase.",
    archetype: "long_horizon",
    specialties: ["music", "entertainment", "creator"],
    boldness: 0.35,
    contrarianism: 0.4,
    recencyWeight: 0.2,
    prestigeBias: 0.6,
    confidenceCal: 0.82,
    riskAppetite: 0.75,
    consensusSensitivity: 0.5,
    activityRate: 0.35,
    daysAgo: 88,
  },
  {
    username: "vibecheck_sa",
    displayName: "VibeCheck_SA",
    bio: "Got a feeling. Always got a feeling.",
    archetype: "recency_bias",
    specialties: ["creator", "music", "entertainment"],
    boldness: 0.9,
    contrarianism: 0.2,
    recencyWeight: 0.8,
    prestigeBias: 0.25,
    confidenceCal: 0.55,
    riskAppetite: 0.25,
    consensusSensitivity: 0.35,
    activityRate: 0.88,
    daysAgo: 30,
  },
];

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

export async function seedAgents(): Promise<{
  created: string[];
  skipped: string[];
  errors: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  log("[AgentSeeder] Starting agent seeding...");

  for (const seed of AGENT_SEEDS) {
    try {
      // Check if agent config already exists
      const [existing] = await db
        .select({ id: agentConfigs.id })
        .from(agentConfigs)
        .where(eq(agentConfigs.username, seed.username))
        .limit(1);

      if (existing) {
        log(`[AgentSeeder] Skipping ${seed.username} — already exists`);
        skipped.push(seed.username);
        continue;
      }

      // Create Supabase Auth account
      const email = `${seed.username}@agents.authoridex.internal`;
      const password = randomBytes(32).toString("hex");

      const { data: authData, error: authError } =
        await supabaseServer.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            display_name: seed.displayName,
            is_agent: true,
          },
        });

      if (authError || !authData.user) {
        const msg = authError?.message ?? "No user returned";
        log(`[AgentSeeder] Auth creation failed for ${seed.username}: ${msg}`);
        errors.push(`${seed.username}: ${msg}`);
        continue;
      }

      const userId = authData.user.id;

      try {
        await db.transaction(async (tx) => {
          await tx.insert(profiles).values({
            id: userId,
            username: seed.username,
            fullName: seed.displayName,
            avatarUrl: `https://api.dicebear.com/7.x/personas/svg?seed=${seed.username}`,
            isPublic: true,
            role: "user",
            isAgent: true,
            predictCredits: 50_000,
            createdAt: pastDate(seed.daysAgo),
          });

          await tx.insert(agentConfigs).values({
            userId,
            displayName: seed.displayName,
            username: seed.username,
            bio: seed.bio,
            archetype: seed.archetype,
            specialties: seed.specialties,
            boldness: seed.boldness.toFixed(2),
            contrarianism: seed.contrarianism.toFixed(2),
            recencyWeight: seed.recencyWeight.toFixed(2),
            prestigeBias: seed.prestigeBias.toFixed(2),
            confidenceCal: seed.confidenceCal.toFixed(2),
            riskAppetite: seed.riskAppetite.toFixed(2),
            consensusSensitivity: seed.consensusSensitivity.toFixed(2),
            activityRate: seed.activityRate.toFixed(2),
          });
        });
      } catch (txErr) {
        log(`[AgentSeeder] DB insert failed for ${seed.username}, removing orphan auth user: ${txErr instanceof Error ? txErr.message : txErr}`);
        await supabaseServer.auth.admin.deleteUser(userId).catch(() => {});
        throw txErr;
      }

      log(
        `[AgentSeeder] Created: ${seed.displayName} (user_id: ${userId})`
      );
      created.push(seed.username);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[AgentSeeder] Error for ${seed.username}: ${msg}`);
      errors.push(`${seed.username}: ${msg}`);
    }
  }

  log(
    `[AgentSeeder] Done. Created: ${created.length}, Skipped: ${skipped.length}, Errors: ${errors.length}`
  );
  return { created, skipped, errors };
}
