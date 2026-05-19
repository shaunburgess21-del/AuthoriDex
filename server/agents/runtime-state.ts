/**
 * Global "pause all agents" kill switch.
 *
 * Backs the admin Agents tab toggle. When the switch is flipped ON, *every*
 * agent worker checks this flag at the top of its tick and exits early:
 *
 *   - `agentRunner.runAgentBatch`        (prediction sweep, every 30 min)
 *   - `actionWorker.processDueActions`   (executes scheduled bets, every 2 min)
 *   - `commentWorker.runCommentSweep`    (daily comment sweep)
 *   - `commentVoteWorker.runCommentVoteSweep` (daily comment-likes sweep)
 *   - `voteWorker.runVoteSweep`          (daily ratings sweep)
 *
 * State is persisted in the `agent_runtime_state` singleton row so toggling
 * doesn't need a deploy and survives restarts. We cache the value in-process
 * for `CACHE_TTL_MS` to avoid hammering the DB on every action-worker tick;
 * the admin can flip the switch and within ~10 seconds every running worker
 * will see the new state.
 *
 * IMPORTANT: This switch ONLY affects agent activity. Non-agent LLM features
 * ("why they're trending", resolution summaries, news ingest, induction
 * cycles, market generation/resolution, etc.) are completely unaffected.
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentRuntimeState } from "@shared/schema";
import { retryWithBackoff } from "./retry";

const SINGLETON_ID = "global";
const CACHE_TTL_MS = 10_000;

// Retry budget for the singleton-row fetch. A fresh process's first
// `isAgentsPaused()` call sometimes coincides with the pooler still
// warming up (single TCP refused, single transient pooler timeout).
// Without retries that one error tips us into the fail-open branch in
// `isAgentsPaused()` and a paused cohort gets to claim a batch on the
// first action-worker tick. 3 attempts inside ~300ms swallows the boot
// hiccup without meaningfully delaying real outages.
const LOAD_RETRY_ATTEMPTS = 3;
const LOAD_RETRY_BASE_DELAY_MS = 100;

interface CachedState {
  paused: boolean;
  reason: string | null;
  pausedAt: Date | null;
  pausedBy: string | null;
  updatedAt: Date;
  fetchedAt: number;
}

let cache: CachedState | null = null;
let inflight: Promise<CachedState> | null = null;

async function loadFromDb(): Promise<CachedState> {
  const rows = await db
    .select()
    .from(agentRuntimeState)
    .where(eq(agentRuntimeState.id, SINGLETON_ID))
    .limit(1);

  const row = rows[0];
  // If the singleton row is missing for any reason (e.g. a fresh DB before
  // the migration ran), default to NOT paused so we never silently kill
  // production. The admin endpoint will create the row on first toggle.
  const state: CachedState = {
    paused: row?.paused ?? false,
    reason: row?.reason ?? null,
    pausedAt: row?.pausedAt ?? null,
    pausedBy: row?.pausedBy ?? null,
    updatedAt: row?.updatedAt ?? new Date(0),
    fetchedAt: Date.now(),
  };
  cache = state;
  return state;
}

async function loadFromDbWithRetry(): Promise<CachedState> {
  return retryWithBackoff(loadFromDb, {
    attempts: LOAD_RETRY_ATTEMPTS,
    // Linear backoff: 100ms, 200ms before the 2nd and 3rd attempts.
    // Total wall-clock budget on the worst path is ~300ms — short
    // enough that an action-worker tick still completes within its
    // 2-min cadence even on a fully-failed fetch.
    delayMs: (attempt) => LOAD_RETRY_BASE_DELAY_MS * (attempt + 1),
    // Surface swallowed transient errors so on-call can see whether
    // the boot-hiccup hypothesis is happening in the wild. Only fires
    // for attempts that DID retry; the final-attempt failure bubbles
    // through `isAgentsPaused()`'s catch as a `console.error` already.
    onRetry: (attempt, err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[AgentRuntimeState] Retrying pause-flag read after attempt ${attempt + 1}/${LOAD_RETRY_ATTEMPTS} failed: ${msg}`,
      );
    },
  });
}

async function getState(): Promise<CachedState> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  // De-duplicate concurrent fetches so a worker burst doesn't fan out
  // dozens of identical SELECTs the moment the cache expires. If the
  // retry wrapper exhausts its budget the inflight promise rejects;
  // every awaiter sees the same rejection and each independently
  // falls into `isAgentsPaused()`'s catch (fail-open). That keeps the
  // de-dup correct on the unhappy path: a single DB outage never
  // starts N concurrent retry storms across worker calls.
  if (inflight) return inflight;
  inflight = loadFromDbWithRetry().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Fast check used by every worker. Resolves to `true` when ALL agent
 * activity should be paused. Cached for ~10 seconds.
 *
 * The DB read is retried up to `LOAD_RETRY_ATTEMPTS` times with linear
 * backoff before this falls into the fail-open branch — a single boot-
 * time pooler hiccup no longer leaks a batch through. Only a sustained
 * outage (every retry failed inside ~300ms) trips the catch.
 */
export async function isAgentsPaused(): Promise<boolean> {
  try {
    const state = await getState();
    return state.paused;
  } catch (err) {
    // Fail OPEN: if the runtime-state table is unreachable we'd rather let
    // agents continue than silently halt the simulation. The admin loses
    // the kill switch in that scenario, but they'd see the DB outage in
    // every other tile too.
    console.error("[AgentRuntimeState] Failed to read pause state:", err);
    return false;
  }
}

/** Returns the full cached state for admin diagnostics. */
export async function getAgentRuntimeState(): Promise<{
  paused: boolean;
  reason: string | null;
  pausedAt: Date | null;
  pausedBy: string | null;
  updatedAt: Date;
}> {
  const state = await getState();
  return {
    paused: state.paused,
    reason: state.reason,
    pausedAt: state.pausedAt,
    pausedBy: state.pausedBy,
    updatedAt: state.updatedAt,
  };
}

interface SetOptions {
  paused: boolean;
  reason?: string | null;
  actorId?: string | null;
}

/** Admin-only mutation. Upserts the singleton row and busts the cache. */
export async function setAgentsPaused(opts: SetOptions): Promise<void> {
  const now = new Date();
  await db
    .insert(agentRuntimeState)
    .values({
      id: SINGLETON_ID,
      paused: opts.paused,
      reason: opts.reason ?? null,
      pausedAt: opts.paused ? now : null,
      pausedBy: opts.paused ? opts.actorId ?? null : null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: agentRuntimeState.id,
      set: {
        paused: opts.paused,
        reason: opts.reason ?? null,
        pausedAt: opts.paused ? now : null,
        pausedBy: opts.paused ? opts.actorId ?? null : null,
        updatedAt: now,
      },
    });

  // Bust the cache so the next isAgentsPaused() call (within the same
  // process) sees the new state immediately rather than waiting for TTL.
  cache = null;
}

/** Test-only: forces the next read to hit the DB. */
export function _resetAgentRuntimeStateCache(): void {
  cache = null;
}
