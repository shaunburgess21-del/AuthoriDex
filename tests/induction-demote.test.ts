/**
 * Integration tests for demoteFromMainLeaderboard / re-promote flow.
 * Run with: INTEGRATION_TESTS=1 npm test -- tests/induction-demote.test.ts
 * Requires DATABASE_URL in .env pointing at a dev database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  inductionCandidates,
  trackedPeople,
  trendingPeople,
} from "../shared/schema";

const integrationEnabled = process.env.INTEGRATION_TESTS === "1";

async function loadDeps() {
  if (!process.env.DATABASE_URL) {
    throw new Error("INTEGRATION_TESTS=1 requires DATABASE_URL");
  }
  const { db } = await import("../server/db");
  const { demoteFromMainLeaderboard, approveInductionCandidate } = await import(
    "../server/services/induction-service"
  );
  return { db, demoteFromMainLeaderboard, approveInductionCandidate };
}

type Db = Awaited<ReturnType<typeof loadDeps>>["db"];

async function cleanupDemoteTest(db: Db, name: string) {
  await db.delete(inductionCandidates).where(eq(inductionCandidates.displayName, name));
  const [tp] = await db
    .select({ id: trackedPeople.id })
    .from(trackedPeople)
    .where(eq(trackedPeople.name, name))
    .limit(1);
  if (tp) {
    await db.delete(trendingPeople).where(eq(trendingPeople.id, tp.id));
    await db.delete(trackedPeople).where(eq(trackedPeople.id, tp.id));
  }
}

test(
  "demote: reactivates inactive inducted candidate and removes trending row",
  { skip: !integrationEnabled },
  async () => {
    const { db, demoteFromMainLeaderboard } = await loadDeps();
    const name = `__demote_reactivate_${Date.now()}__`;
    await cleanupDemoteTest(db, name);

    try {
      const [tp] = await db
        .insert(trackedPeople)
        .values({
          name,
          category: "music",
          status: "main_leaderboard",
          imageSlug: "demote-test",
        })
        .returning();

      await db.insert(trendingPeople).values({
        id: tp.id,
        name,
        category: "music",
        rank: 99,
        trendScore: 1,
        fameIndex: 100,
      });

      const [candidate] = await db
        .insert(inductionCandidates)
        .values({
          displayName: name,
          category: "music",
          imageSlug: "demote-test",
          seedVotes: 12,
          inductionStatus: "Inducted",
          isActive: false,
        })
        .returning();

      const result = await demoteFromMainLeaderboard(tp.id);
      assert.equal(result.candidateId, candidate.id);
      assert.equal(result.createdCandidate, false);

      const [tpAfter] = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.id, tp.id))
        .limit(1);
      assert.equal(tpAfter?.status, "induction");

      const [cAfter] = await db
        .select()
        .from(inductionCandidates)
        .where(eq(inductionCandidates.id, candidate.id))
        .limit(1);
      assert.equal(cAfter?.isActive, true);
      assert.equal(cAfter?.inductionStatus, "Queue");
      assert.equal(cAfter?.seedVotes, 12);

      const trending = await db
        .select()
        .from(trendingPeople)
        .where(eq(trendingPeople.id, tp.id));
      assert.equal(trending.length, 0);
    } finally {
      await cleanupDemoteTest(db, name);
    }
  },
);

test(
  "demote: creates induction candidate when none exists (Lisa-like)",
  { skip: !integrationEnabled },
  async () => {
    const { db, demoteFromMainLeaderboard } = await loadDeps();
    const name = `__demote_create_${Date.now()}__`;
    await cleanupDemoteTest(db, name);

    try {
      const [tp] = await db
        .insert(trackedPeople)
        .values({
          name,
          category: "music",
          status: "main_leaderboard",
          wikiSlug: "Test_Artist",
        })
        .returning();

      await db.insert(trendingPeople).values({
        id: tp.id,
        name,
        category: "music",
        rank: 50,
        trendScore: 0,
        fameIndex: 0,
      });

      const result = await demoteFromMainLeaderboard(tp.id);
      assert.equal(result.createdCandidate, true);

      const [c] = await db
        .select()
        .from(inductionCandidates)
        .where(eq(inductionCandidates.id, result.candidateId))
        .limit(1);
      assert.ok(c);
      assert.equal(c?.displayName, name);
      assert.equal(c?.isActive, true);
      assert.equal(c?.wikiSlug, "Test_Artist");
    } finally {
      await cleanupDemoteTest(db, name);
    }
  },
);

test(
  "demote then approve restores main_leaderboard and trending_people",
  { skip: !integrationEnabled },
  async () => {
    const { db, demoteFromMainLeaderboard, approveInductionCandidate } =
      await loadDeps();
    const name = `__demote_promote_${Date.now()}__`;
    await cleanupDemoteTest(db, name);

    try {
      const [tp] = await db
        .insert(trackedPeople)
        .values({
          name,
          category: "tech",
          status: "main_leaderboard",
        })
        .returning();

      await db.insert(trendingPeople).values({
        id: tp.id,
        name,
        category: "tech",
        rank: 1,
        trendScore: 0,
        fameIndex: 0,
      });

      const [candidate] = await db
        .insert(inductionCandidates)
        .values({
          displayName: name,
          category: "tech",
          seedVotes: 3,
          inductionStatus: "Inducted",
          isActive: false,
        })
        .returning();

      await demoteFromMainLeaderboard(tp.id);

      await approveInductionCandidate(candidate.id, { runOnboarding: false });

      const [tpAfter] = await db
        .select()
        .from(trackedPeople)
        .where(eq(trackedPeople.id, tp.id))
        .limit(1);
      assert.equal(tpAfter?.status, "main_leaderboard");

      const [trending] = await db
        .select()
        .from(trendingPeople)
        .where(eq(trendingPeople.id, tp.id))
        .limit(1);
      assert.ok(trending);
      assert.equal(trending?.name, name);
    } finally {
      await cleanupDemoteTest(db, name);
    }
  },
);

test(
  "demote: rejects when person is not on main leaderboard",
  { skip: !integrationEnabled },
  async () => {
    const { db, demoteFromMainLeaderboard } = await loadDeps();
    const name = `__demote_reject_${Date.now()}__`;
    await cleanupDemoteTest(db, name);

    try {
      const [tp] = await db
        .insert(trackedPeople)
        .values({
          name,
          category: "music",
          status: "induction",
        })
        .returning();

      await assert.rejects(
        () => demoteFromMainLeaderboard(tp.id),
        (err: Error & { statusCode?: number }) => {
          assert.equal(err.statusCode, 409);
          return true;
        },
      );
    } finally {
      await cleanupDemoteTest(db, name);
    }
  },
);
