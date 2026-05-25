import { storage } from "../storage";
import { getBaselineDiagnostics } from "../utils/baseline";
import {
  generateWhyTrendingSummary,
  WHY_TRENDING_RANK_CUTOFF,
  type WhyTrendingCacheStatus,
  type WhyTrendingPayload,
} from "../services/why-trending";
import type { TrendingPerson } from "@shared/schema";

const BATCH_SIZE = 3;
const BATCH_DELAY_MS = 1000;
const HOT_MOVERS_CAP = 5;

export interface WhyTrendingCronResult {
  total: number;
  candidates: number;
  regenerated: number;
  extended: number;
  hit: number;
  rateLimited: number;
  locked: number;
  noNews: number;
  providerUnavailable: number;
  skipped: number;
  errors: number;
  errorNames: string[];
  durationMs: number;
}

function classifyOutcome(payload: WhyTrendingPayload): WhyTrendingCacheStatus | "error" {
  return payload.cacheStatus ?? (payload.hasContext ? "REGENERATED" : "NO_NEWS");
}

async function collectEligiblePeople(): Promise<Array<{ person: TrendingPerson; hotMover: boolean }>> {
  let people = await storage.getTrendingPeople();
  if (people.length === 0) {
    return [];
  }

  const baselineMeta = await getBaselineDiagnostics(people.length);
  const byId = new Map<string, { person: TrendingPerson; hotMover: boolean }>();

  for (const person of people) {
    if ((person.rank ?? 999) <= WHY_TRENDING_RANK_CUTOFF) {
      byId.set(person.id, { person, hotMover: false });
    }
  }

  if (baselineMeta.baseline24hStatus === "normal") {
    const hotCandidates = people
      .filter((p) => p.change24h != null && p.change24h > 0)
      .sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0))
      .slice(0, HOT_MOVERS_CAP);

    for (const person of hotCandidates) {
      if (!byId.has(person.id)) {
        byId.set(person.id, { person, hotMover: true });
      } else {
        byId.get(person.id)!.hotMover = true;
      }
    }
  }

  return Array.from(byId.values());
}

export async function runWhyTrendingCronRefresh(): Promise<WhyTrendingCronResult> {
  const startTime = Date.now();
  const eligible = await collectEligiblePeople();

  let regenerated = 0;
  let extended = 0;
  let hit = 0;
  let rateLimited = 0;
  let locked = 0;
  let noNews = 0;
  let providerUnavailable = 0;
  let errors = 0;
  const errorNames: string[] = [];

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ person, hotMover }) => {
        try {
          // Skip updateTopNEligibility: cron's selection is the source of truth here.
          // HTTP visits keep the cached state warm for their own short-circuit path.
          const result = await generateWhyTrendingSummary(person, { hotMover });
          const status = classifyOutcome(result);
          switch (status) {
            case "REGENERATED":
              regenerated++;
              break;
            case "STALE_EXTENDED":
              extended++;
              break;
            case "HIT":
              hit++;
              break;
            case "RATE_LIMITED":
              rateLimited++;
              break;
            case "LOCKED_STALE":
            case "LOCKED_COLD":
              locked++;
              break;
            case "NO_NEWS":
              noNews++;
              break;
            case "PROVIDER_UNAVAILABLE":
              providerUnavailable++;
              break;
            default:
              if (result.hasContext) regenerated++;
              else noNews++;
          }
        } catch (err: any) {
          errors++;
          errorNames.push(`${person.name}: ${err.message}`);
          console.error(`[WhyTrendingCron] Failed ${person.name}:`, err.message);
        }
      }),
    );
    if (i + BATCH_SIZE < eligible.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(
    `[WhyTrendingCron] warmed=${regenerated} extended=${extended} hit=${hit} ` +
      `rateLimited=${rateLimited} locked=${locked} noNews=${noNews} ` +
      `providerUnavailable=${providerUnavailable} errors=${errors} (${durationMs}ms)`,
  );

  return {
    total: eligible.length,
    candidates: eligible.length,
    regenerated,
    extended,
    hit,
    rateLimited,
    locked,
    noNews,
    providerUnavailable,
    skipped: 0,
    errors,
    errorNames: errorNames.slice(0, 20),
    durationMs,
  };
}
