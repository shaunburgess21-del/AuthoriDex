import { db } from "../db";
import { agentMemory } from "@shared/schema";
import { eq, asc, desc } from "drizzle-orm";
import { MEMORY_CAP } from "./constants";
import type { AgentMemoryData } from "./types";

export async function getRecentMemory(
  agentId: string,
  limit = 5
): Promise<AgentMemoryData[]> {
  const rows = await db
    .select({
      memoryType: agentMemory.memoryType,
      content: agentMemory.content,
      category: agentMemory.category,
    })
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId))
    .orderBy(desc(agentMemory.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    memoryType: r.memoryType as AgentMemoryData["memoryType"],
    content: r.content,
    category: r.category ?? undefined,
  }));
}

export async function addMemory(
  agentId: string,
  memory: AgentMemoryData
): Promise<void> {
  const existing = await db
    .select({ id: agentMemory.id })
    .from(agentMemory)
    .where(eq(agentMemory.agentId, agentId));

  if (existing.length >= MEMORY_CAP) {
    const oldest = await db
      .select({ id: agentMemory.id })
      .from(agentMemory)
      .where(eq(agentMemory.agentId, agentId))
      .orderBy(asc(agentMemory.createdAt))
      .limit(1);

    if (oldest[0]) {
      await db.delete(agentMemory).where(eq(agentMemory.id, oldest[0].id));
    }
  }

  await db.insert(agentMemory).values({
    agentId,
    memoryType: memory.memoryType,
    content: memory.content,
    category: memory.category ?? null,
  });
}
