/**
 * V2 simulation seeder: archives legacy obvious agents and creates a larger
 * human-style cohort with internal persona metadata.
 */

import { supabaseServer } from "../supabase";
import { db } from "../db";
import { profiles, agentConfigs, scheduledAgentActions } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { log } from "../log";
import { AGENT_CREDIT_TOPUP_TARGET } from "./constants";
import { agentAvatarSeed, uploadGeneratedAgentAvatar } from "./avatarGenerator";
import {
  SIMULATION_V2_COHORT_ID,
  type AgentSimulationProfile,
  type SimulationPersonaBand,
  isV2SimulationProfile,
} from "./simulationProfile";

type AgentSeed = {
  username: string;
  displayName: string;
  bio: string;
  archetype: string;
  specialties: string[];
  boldness: number;
  contrarianism: number;
  recencyWeight: number;
  prestigeBias: number;
  confidenceCal: number;
  riskAppetite: number;
  consensusSensitivity: number;
  activityRate: number;
  daysAgo: number;
  xpPoints: number;
  rank: string;
  predictCredits: number;
  simulationProfile: AgentSimulationProfile;
};

const V2_HANDLES: Array<{ username: string; band: SimulationPersonaBand; specialties: string[] }> = [
  { username: "BetTom42", band: "casual", specialties: ["sports", "entertainment"] },
  { username: "mikaOdds", band: "sharp", specialties: ["music", "creator"] },
  { username: "dawnpriced", band: "sharp", specialties: ["business", "politics"] },
  { username: "JoziLedger", band: "liquidity", specialties: ["sports", "music"] },
  { username: "knotfade", band: "noisy", specialties: ["entertainment", "creator"] },
  { username: "plumline8", band: "casual", specialties: ["music", "entertainment"] },
  { username: "NiaStack", band: "sharp", specialties: ["sports", "tech"] },
  { username: "metroMilo", band: "casual", specialties: ["creator", "music"] },
  { username: "quietEdge", band: "sharp", specialties: ["politics", "business"] },
  { username: "TapiwaTakes", band: "casual", specialties: ["sports", "entertainment"] },
  { username: "randside", band: "liquidity", specialties: ["business", "sports"] },
  { username: "lunaOver", band: "noisy", specialties: ["music", "creator"] },
  { username: "wagerWren", band: "casual", specialties: ["entertainment", "music"] },
  { username: "capetownCal", band: "casual", specialties: ["sports", "creator"] },
  { username: "saffronSlip", band: "casual", specialties: ["politics", "business"] },
  { username: "evKabelo", band: "sharp", specialties: ["sports", "business"] },
  { username: "matchaMarket", band: "liquidity", specialties: ["music", "entertainment"] },
  { username: "zebraParlay", band: "noisy", specialties: ["sports", "creator"] },
  { username: "pixelPunter", band: "casual", specialties: ["tech", "creator"] },
  { username: "TheoTick", band: "sharp", specialties: ["entertainment", "music"] },
  { username: "greenroomGus", band: "casual", specialties: ["music", "entertainment"] },
  { username: "bigNandi", band: "whale", specialties: ["sports", "business"] },
  { username: "skewedSam", band: "noisy", specialties: ["politics", "sports"] },
  { username: "marulaLine", band: "casual", specialties: ["creator", "entertainment"] },
  { username: "oddsAnele", band: "sharp", specialties: ["politics", "tech"] },
  { username: "biscuitAlpha", band: "casual", specialties: ["music", "creator"] },
  { username: "poolsidePip", band: "liquidity", specialties: ["sports", "entertainment"] },
  { username: "reckonRue", band: "casual", specialties: ["business", "politics"] },
  { username: "MphoMoonshot", band: "noisy", specialties: ["creator", "music"] },
  { username: "cedarBook", band: "casual", specialties: ["tech", "business"] },
  { username: "rareForm", band: "sharp", specialties: ["sports", "music"] },
  { username: "DurbnDelta", band: "casual", specialties: ["entertainment", "sports"] },
  { username: "chalkRiver", band: "liquidity", specialties: ["business", "politics"] },
  { username: "luckyMole", band: "noisy", specialties: ["sports", "entertainment"] },
  { username: "VusiValue", band: "sharp", specialties: ["business", "sports"] },
  { username: "peachTicket", band: "casual", specialties: ["music", "creator"] },
  { username: "needlePrice", band: "sharp", specialties: ["tech", "business"] },
  { username: "sunsetStake", band: "casual", specialties: ["entertainment", "music"] },
  { username: "PennyKicks", band: "casual", specialties: ["sports", "creator"] },
  { username: "massiveMoss", band: "whale", specialties: ["entertainment", "sports"] },
  { username: "rumourRatio", band: "noisy", specialties: ["creator", "entertainment"] },
  { username: "TableTopEV", band: "sharp", specialties: ["politics", "business"] },
  { username: "bloomBets", band: "casual", specialties: ["music", "business"] },
  { username: "sourSignal", band: "noisy", specialties: ["politics", "entertainment"] },
  { username: "flatlineFlo", band: "liquidity", specialties: ["sports", "tech"] },
  { username: "JunoJuice", band: "casual", specialties: ["creator", "music"] },
  { username: "properPrice", band: "sharp", specialties: ["sports", "politics"] },
  { username: "smallEdge", band: "liquidity", specialties: ["business", "tech"] },
  { username: "NateNoChill", band: "noisy", specialties: ["sports", "music"] },
  { username: "fameFolio", band: "casual", specialties: ["entertainment", "creator"] },
  { username: "irisIndex", band: "casual", specialties: ["politics", "tech"] },
  { username: "whaleKaya", band: "whale", specialties: ["business", "entertainment"] },
  { username: "ZolaZigs", band: "casual", specialties: ["sports", "creator"] },
  { username: "lineLentil", band: "liquidity", specialties: ["music", "business"] },
  { username: "bentOdds", band: "noisy", specialties: ["creator", "sports"] },
  { username: "maybMarket", band: "casual", specialties: ["entertainment", "politics"] },
];

const BAND_TRAITS: Record<SimulationPersonaBand, Omit<AgentSeed, "username" | "displayName" | "specialties" | "daysAgo" | "xpPoints" | "rank" | "predictCredits" | "simulationProfile">> = {
  sharp: {
    bio: "Picks spots carefully and hates bad prices.",
    archetype: "domain_specialist",
    boldness: 0.52,
    contrarianism: 0.34,
    recencyWeight: 0.48,
    prestigeBias: 0.50,
    confidenceCal: 0.78,
    riskAppetite: 0.42,
    consensusSensitivity: 0.34,
    activityRate: 0.42,
  },
  casual: {
    bio: "Follows the market, the timeline, and the occasional hunch.",
    archetype: "momentum_chaser",
    boldness: 0.62,
    contrarianism: 0.28,
    recencyWeight: 0.68,
    prestigeBias: 0.42,
    confidenceCal: 0.62,
    riskAppetite: 0.48,
    consensusSensitivity: 0.48,
    activityRate: 0.62,
  },
  noisy: {
    bio: "High variance, loud opinions, and not always enough patience.",
    archetype: "chaos_agent",
    boldness: 0.84,
    contrarianism: 0.62,
    recencyWeight: 0.76,
    prestigeBias: 0.28,
    confidenceCal: 0.48,
    riskAppetite: 0.72,
    consensusSensitivity: 0.32,
    activityRate: 0.74,
  },
  liquidity: {
    bio: "Small positions across many cards, usually near the middle.",
    archetype: "conservative",
    boldness: 0.38,
    contrarianism: 0.24,
    recencyWeight: 0.50,
    prestigeBias: 0.46,
    confidenceCal: 0.60,
    riskAppetite: 0.30,
    consensusSensitivity: 0.72,
    activityRate: 0.82,
  },
  whale: {
    bio: "Rarely everywhere, sometimes very present.",
    archetype: "high_conviction",
    boldness: 0.78,
    contrarianism: 0.40,
    recencyWeight: 0.52,
    prestigeBias: 0.56,
    confidenceCal: 0.70,
    riskAppetite: 0.82,
    consensusSensitivity: 0.30,
    activityRate: 0.30,
  },
};

function hashNumber(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRoll(input: string, min: number, max: number): number {
  const roll = hashNumber(input) / 0xffffffff;
  return min + (max - min) * roll;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildSimulationProfile(seed: typeof V2_HANDLES[number]): AgentSimulationProfile {
  const band = seed.band;
  const skillBase = band === "sharp" ? 0.82 : band === "whale" ? 0.68 : band === "liquidity" ? 0.58 : band === "casual" ? 0.52 : 0.34;
  const jitter = seededRoll(`${seed.username}:skill`, -0.08, 0.08);
  const large = band === "whale";

  return {
    schemaVersion: 2,
    cohortId: SIMULATION_V2_COHORT_ID,
    personaBand: band,
    skillTier: clamp01(skillBase + jitter),
    favoriteCategories: seed.specialties,
    edgeThreshold: band === "sharp" ? 0.05 : band === "liquidity" ? -0.03 : band === "noisy" ? -0.12 : band === "whale" ? 0.02 : -0.05,
    publicConfidenceRate: band === "sharp" ? 0.12 : band === "noisy" ? 0.35 : 0.22,
    stakeMultiplier: large ? 2.6 : band === "liquidity" ? 0.65 : band === "sharp" ? 1.25 : band === "noisy" ? 1.05 : 0.9,
    minStake: large ? 200 : band === "liquidity" ? 40 : 75,
    maxStake: large ? 950 : band === "sharp" ? 380 : band === "noisy" ? 300 : 220,
    // Cap headroom: half the cap is consumed by inline voting in the
    // comment sweep (vote-first rule on polls/matchups), the other half
    // funds the standalone vote sweep. Old caps (3-7) left ~0 budget for
    // the daily vote sweep by Wed-Thu and produced 100% world-market
    // commenting + zero standalone votes by Sat. New caps roughly double
    // the headroom so both surfaces stay active across the full week.
    weeklyVoteCap: band === "liquidity" ? 12 : band === "noisy" ? 10 : band === "sharp" ? 6 : 8,
    // Comment frequency dialled down ~50% from the post-fix volume after
    // the cohort started commenting "hard and fast" across all surfaces.
    // Both knobs are halved so volume and pacing both come down: halving
    // only the chance would front-load comments early in the week and
    // then go silent once caps hit; halving only the cap would still
    // burn through the budget at the same rate just for fewer days.
    //   noisy/casual: 4 -> 2 weekly comments
    //   sharp/whale:  2 -> 1
    //   liquidity:    1 -> 1 (already minimum)
    weeklyCommentCap:
      band === "noisy" ? 2 :
      band === "casual" ? 2 :
      band === "liquidity" ? 1 :
      1, // sharp + whale
    dailyVoteChance: band === "liquidity" ? 0.78 : band === "noisy" ? 0.72 : band === "sharp" ? 0.38 : 0.56,
    // Per-sweep dice roll (sweep runs every 4h = 6x/day). Halved from
    // 0.14/0.08/0.05 -> 0.07/0.04/0.025.
    dailyCommentChance: band === "noisy" ? 0.07 : band === "casual" ? 0.04 : 0.025,
    commentStyle: band === "sharp" ? "analytical" : band === "noisy" ? "skeptical" : band === "liquidity" ? "short" : "casual",
    bankrollProfile: large ? "large" : band === "liquidity" ? "small" : "normal",
  };
}

const AGENT_SEEDS: AgentSeed[] = V2_HANDLES.map((handle, index) => {
  const traits = BAND_TRAITS[handle.band];
  const variance = seededRoll(`${handle.username}:traits`, -0.06, 0.06);
  const daysAgo = Math.round(seededRoll(`${handle.username}:age`, 18, 130));
  const xpPoints = Math.round(seededRoll(`${handle.username}:xp`, 90, handle.band === "whale" ? 4200 : 1800));
  const rank = xpPoints > 2800 ? "Analyst" : xpPoints > 1400 ? "Insider" : xpPoints > 450 ? "Aspirant" : "Citizen";
  const creditsBase = handle.band === "whale" ? 22000 : handle.band === "sharp" ? 14000 : AGENT_CREDIT_TOPUP_TARGET;

  return {
    username: handle.username,
    displayName: handle.username,
    bio: traits.bio,
    archetype: traits.archetype,
    specialties: handle.specialties,
    boldness: clamp01(traits.boldness + variance),
    contrarianism: clamp01(traits.contrarianism - variance / 2),
    recencyWeight: clamp01(traits.recencyWeight + variance / 2),
    prestigeBias: clamp01(traits.prestigeBias - variance / 3),
    confidenceCal: clamp01(traits.confidenceCal + variance / 2),
    riskAppetite: clamp01(traits.riskAppetite + variance),
    consensusSensitivity: clamp01(traits.consensusSensitivity - variance / 2),
    activityRate: clamp01(traits.activityRate + variance / 3),
    daysAgo: daysAgo + (index % 5),
    xpPoints,
    rank,
    predictCredits: Math.round(creditsBase + seededRoll(`${handle.username}:credits`, -1200, 1800)),
    simulationProfile: buildSimulationProfile(handle),
  };
});

function pastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

export async function archiveLegacyAgents(options: { hideProfiles?: boolean } = {}): Promise<{
  archived: number;
  hiddenProfiles: number;
  skippedV2: number;
  skippedActions: number;
}> {
  const hideProfiles = options.hideProfiles ?? true;
  const activeAgents = await db
    .select({
      id: agentConfigs.id,
      userId: agentConfigs.userId,
      username: agentConfigs.username,
      simulationProfile: agentConfigs.simulationProfile,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  const legacyAgents = activeAgents.filter((agent) => !isV2SimulationProfile(agent.simulationProfile));
  const legacyIds = legacyAgents.map((agent) => agent.id);
  const legacyUserIds = legacyAgents.map((agent) => agent.userId);

  if (legacyIds.length === 0) {
    return {
      archived: 0,
      hiddenProfiles: 0,
      skippedV2: activeAgents.length,
      skippedActions: 0,
    };
  }

  const now = new Date();
  await db
    .update(agentConfigs)
    .set({ isActive: false, updatedAt: now })
    .where(inArray(agentConfigs.id, legacyIds));

  const skipped = await db
    .update(scheduledAgentActions)
    .set({
      status: "skipped",
      errorMessage: "Legacy agent archived",
      executedAt: now,
    })
    .where(
      and(
        inArray(scheduledAgentActions.agentId, legacyIds),
        sql`${scheduledAgentActions.status} IN ('pending', 'in_progress')`,
      )
    )
    .returning({ id: scheduledAgentActions.id });

  let hiddenProfiles = 0;
  if (hideProfiles && legacyUserIds.length > 0) {
    const hidden = await db
      .update(profiles)
      .set({ isPublic: false, lastActiveAt: now })
      .where(inArray(profiles.id, legacyUserIds))
      .returning({ id: profiles.id });
    hiddenProfiles = hidden.length;
  }

  log(`[AgentSeeder] Archived ${legacyIds.length} legacy agents; hid ${hiddenProfiles} profiles`);

  return {
    archived: legacyIds.length,
    hiddenProfiles,
    skippedV2: activeAgents.length - legacyIds.length,
    skippedActions: skipped.length,
  };
}

/**
 * Re-runs `buildSimulationProfile` for every existing V2 agent and writes
 * the result back to `agent_configs.simulation_profile`. Use this after
 * tuning persona caps/chances in the seeder so existing agents pick up
 * the new values without having to delete + reseed (which would wipe
 * P&L history). Idempotent: if the stored profile already equals what
 * the seeder would produce, the row is left untouched.
 */
export async function refreshAgentSimulationProfiles(): Promise<{
  refreshed: number;
  unchanged: number;
  missingSeed: string[];
}> {
  const seedByUsername = new Map(AGENT_SEEDS.map((seed) => [seed.username, seed]));
  const agents = await db
    .select({
      id: agentConfigs.id,
      username: agentConfigs.username,
      simulationProfile: agentConfigs.simulationProfile,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.isActive, true));

  let refreshed = 0;
  let unchanged = 0;
  const missingSeed: string[] = [];
  const now = new Date();

  for (const agent of agents) {
    const seed = seedByUsername.get(agent.username);
    if (!seed) {
      missingSeed.push(agent.username);
      continue;
    }

    const next = seed.simulationProfile;
    const prev = agent.simulationProfile;
    if (prev && JSON.stringify(prev) === JSON.stringify(next)) {
      unchanged++;
      continue;
    }

    await db
      .update(agentConfigs)
      .set({ simulationProfile: next, updatedAt: now })
      .where(eq(agentConfigs.id, agent.id));
    refreshed++;
  }

  log(`[AgentSeeder] refreshAgentSimulationProfiles: ${refreshed} refreshed, ${unchanged} unchanged, ${missingSeed.length} missing seed`);
  return { refreshed, unchanged, missingSeed };
}

export async function seedAgents(): Promise<{
  created: string[];
  skipped: string[];
  errors: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  log(`[AgentSeeder] Starting ${SIMULATION_V2_COHORT_ID} seeding...`);

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
            simulation_cohort: SIMULATION_V2_COHORT_ID,
          },
        });

      if (authError || !authData.user) {
        const msg = authError?.message ?? "No user returned";
        log(`[AgentSeeder] Auth creation failed for ${seed.username}: ${msg}`);
        errors.push(`${seed.username}: ${msg}`);
        continue;
      }

      const userId = authData.user.id;
      const avatarSeed = agentAvatarSeed(userId);
      let avatarUrl: string | null = null;

      try {
        avatarUrl = await uploadGeneratedAgentAvatar(userId, avatarSeed);
      } catch (avatarErr) {
        log(`[AgentSeeder] Avatar generation failed for ${seed.username}; falling back to initials: ${avatarErr instanceof Error ? avatarErr.message : avatarErr}`);
      }

      try {
        await db.transaction(async (tx) => {
          await tx.insert(profiles).values({
            id: userId,
            username: seed.username,
            avatarUrl,
            avatarSeed,
            isPublic: true,
            role: "user",
            rank: seed.rank,
            xpPoints: seed.xpPoints,
            isAgent: true,
            predictCredits: seed.predictCredits,
            lastActiveAt: pastDate(Math.max(1, Math.round(seed.daysAgo / 3))),
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
            simulationProfile: seed.simulationProfile,
            isActive: true,
          });
        });
      } catch (txErr) {
        log(`[AgentSeeder] DB insert failed for ${seed.username}, removing orphan auth user: ${txErr instanceof Error ? txErr.message : txErr}`);
        await supabaseServer.auth.admin.deleteUser(userId).catch((cleanupErr: unknown) => {
          log(`[AgentSeeder] Failed to remove orphan auth user ${userId}: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
        });
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
