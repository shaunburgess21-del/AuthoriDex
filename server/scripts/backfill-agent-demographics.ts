/**
 * Backfill demographic + onboarding fields on existing simulation agents.
 *
 * Run:
 *   node --env-file=.env --import tsx server/scripts/backfill-agent-demographics.ts
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentConfigs, profiles } from "@shared/schema";
import { assignAgentDemographics } from "../agents/agentDemographics";
import { checkAndAwardProfileBadges } from "../services/badges";

async function main(): Promise<void> {
  const agents = await db
    .select({
      userId: profiles.id,
      username: profiles.username,
      createdAt: profiles.createdAt,
      bio: agentConfigs.bio,
      specialties: agentConfigs.specialties,
    })
    .from(profiles)
    .innerJoin(agentConfigs, eq(agentConfigs.userId, profiles.id))
    .where(eq(profiles.isAgent, true));

  console.log(`[backfill-agent-demographics] Found ${agents.length} agent profiles`);

  let updated = 0;
  for (const agent of agents) {
    if (!agent.username) {
      console.warn(`[backfill-agent-demographics] skip ${agent.userId}: missing username`);
      continue;
    }

    const createdAt = agent.createdAt ?? new Date();
    const demographics = assignAgentDemographics({
      username: agent.username,
      bio: agent.bio ?? "",
      specialties: agent.specialties ?? [],
      createdAt,
    });

    await db
      .update(profiles)
      .set(demographics)
      .where(eq(profiles.id, agent.userId));

    await checkAndAwardProfileBadges(agent.userId);
    updated += 1;

    if (updated % 10 === 0) {
      console.log(`[backfill-agent-demographics] ${updated}/${agents.length} updated`);
    }
  }

  console.log(`[backfill-agent-demographics] Done. Updated ${updated} profiles.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[backfill-agent-demographics] fatal", err);
    process.exit(1);
  });
