/**
 * OpenAI omni-moderation text scanner + decision bands.
 *
 * Fail-open: API errors / missing key / kill switch off → allow (optionally
 * with a review queue entry when the caller asks for fail-open queuing).
 */

import OpenAI from "openai";
import { matchLocalBlocklist } from "./blocklist";
import {
  AUTO_HIDE_CATEGORIES,
  MODERATION_AUTO_HIDE_THRESHOLD,
  MODERATION_REVIEW_THRESHOLD,
  REVIEW_CATEGORIES,
  TEXT_MODERATION_ENABLED,
} from "./config";
import type { ModerationCategoryScores, ModerationDecision, TextModerationResult } from "./types";

const SAMPLE_MAX = 280;
const API_TIMEOUT_MS = 8_000;

let _client: OpenAI | null = null;
function getClient(): OpenAI | null {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!_client) {
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

function sampleText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SAMPLE_MAX) return trimmed;
  return `${trimmed.slice(0, SAMPLE_MAX)}…`;
}

/** Exported for unit tests — maps Omni category scores to allow/review/auto_hide. */
export function decideFromScores(
  scores: ModerationCategoryScores,
  _flagged: boolean,
): { decision: ModerationDecision; matchedCategories: string[] } {
  const matched: string[] = [];

  for (const cat of AUTO_HIDE_CATEGORIES) {
    const score = scores[cat] ?? 0;
    if (score >= MODERATION_AUTO_HIDE_THRESHOLD) {
      matched.push(cat);
    }
  }
  if (matched.length > 0) {
    return { decision: "auto_hide", matchedCategories: matched };
  }

  for (const cat of REVIEW_CATEGORIES) {
    const score = scores[cat] ?? 0;
    if (score >= MODERATION_REVIEW_THRESHOLD) {
      matched.push(cat);
    }
  }
  // X-like: ignore Omni's bare `flagged` bit — decide only from our
  // category score thresholds so heated debate isn't over-queued.
  if (matched.length > 0) {
    return { decision: "review", matchedCategories: matched };
  }

  return { decision: "allow", matchedCategories: [] };
}

/**
 * Classify free text. Never throws — callers can await safely on the hot path.
 */
export async function moderateText(text: string): Promise<TextModerationResult> {
  const sample = sampleText(text || "");

  if (!TEXT_MODERATION_ENABLED) {
    return {
      decision: "allow",
      flagged: false,
      scores: {},
      matchedCategories: [],
      failOpen: true,
      provider: "disabled",
      sampleText: sample,
    };
  }

  if (!text || !text.trim()) {
    return {
      decision: "allow",
      flagged: false,
      scores: {},
      matchedCategories: [],
      failOpen: false,
      provider: "openai_omni",
      sampleText: sample,
    };
  }

  const localHits = matchLocalBlocklist(text);
  if (localHits.length > 0) {
    return {
      decision: "auto_hide",
      flagged: true,
      scores: { local_blocklist: 1 },
      matchedCategories: localHits,
      failOpen: false,
      provider: "local_blocklist",
      sampleText: sample,
    };
  }

  const client = getClient();
  if (!client) {
    console.warn("[moderation] No OpenAI API key — fail-open allow");
    return {
      decision: "allow",
      flagged: false,
      scores: {},
      matchedCategories: [],
      failOpen: true,
      provider: "error",
      sampleText: sample,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let response: OpenAI.Moderations.ModerationCreateResponse;
    try {
      response = await client.moderations.create(
        {
          model: "omni-moderation-latest",
          input: text,
        },
        { signal: controller.signal },
      );
    } finally {
      clearTimeout(timeout);
    }

    const result = response.results[0];
    if (!result) {
      return {
        decision: "allow",
        flagged: false,
        scores: {},
        matchedCategories: [],
        failOpen: true,
        provider: "error",
        sampleText: sample,
      };
    }

    const scores: ModerationCategoryScores = {
      ...(result.category_scores as unknown as ModerationCategoryScores),
    };
    const { decision, matchedCategories } = decideFromScores(scores, Boolean(result.flagged));

    return {
      decision,
      flagged: Boolean(result.flagged),
      scores,
      matchedCategories,
      failOpen: false,
      provider: "openai_omni",
      sampleText: sample,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[moderation] omni-moderation failed (fail-open): ${message}`);
    return {
      decision: "allow",
      flagged: false,
      scores: {},
      matchedCategories: [],
      failOpen: true,
      provider: "error",
      sampleText: sample,
    };
  }
}
