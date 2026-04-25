import { inArray } from "drizzle-orm";
import { db } from "../db";
import { trackedPeople, type TrackedPerson, type TrendingPerson } from "@shared/schema";
import { generateProfilePreview } from "../services/profile-generator";

const DEFAULT_EVAL_NAMES = [
  "Pete Hegseth",
  "John Ternus",
  "Viktor Orban",
  "Elon Musk",
];

const models = (process.env.PROFILE_EVAL_MODELS || "gpt-5.1,gpt-5.4")
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

const names = (process.env.PROFILE_EVAL_NAMES || DEFAULT_EVAL_NAMES.join(","))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

async function evaluateProfileModels() {
  if (models.length === 0) {
    throw new Error("No models configured. Set PROFILE_EVAL_MODELS=gpt-5.1,gpt-5.4");
  }

  const people = await db
    .select()
    .from(trackedPeople)
    .where(inArray(trackedPeople.name, names));

  const missing = names.filter((name) => !people.some((person) => person.name === name));
  if (missing.length > 0) {
    console.warn(`[ProfileEval] Missing tracked people: ${missing.join(", ")}`);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const person of people) {
    for (const model of models) {
      const startedAt = Date.now();
      try {
        const preview = await generateProfilePreview(toTrendingPerson(person), model);
        results.push({
          person: person.name,
          model,
          ok: true,
          durationMs: Date.now() - startedAt,
          shortBio: preview.profileData.shortBio,
          longBio: preview.profileData.longBio,
          estimatedNetWorth: preview.profileData.estimatedNetWorth,
          confidence: preview.profileData.confidence,
          validationNotes: preview.validationNotes,
          sourceUrls: preview.sourceUrls.slice(0, 5),
        });
      } catch (error: any) {
        results.push({
          person: person.name,
          model,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: error?.message ?? String(error),
        });
      }
    }
  }

  console.log(JSON.stringify({
    evaluatedAt: new Date().toISOString(),
    models,
    names,
    results,
  }, null, 2));
}

function toTrendingPerson(person: TrackedPerson): TrendingPerson {
  return {
    id: person.id,
    name: person.name,
    avatar: person.avatar ?? null,
    bio: person.bio ?? null,
    rank: person.displayOrder || 9999,
    trendScore: 0,
    fameIndex: 0,
    fameIndexLive: null,
    liveRank: null,
    liveUpdatedAt: null,
    liveDampen: null,
    change24h: null,
    change7d: null,
    category: person.category,
    profileViews10m: null,
  };
}

evaluateProfileModels().catch((error) => {
  console.error("[ProfileEval] Fatal error:", error);
  process.exit(1);
});
