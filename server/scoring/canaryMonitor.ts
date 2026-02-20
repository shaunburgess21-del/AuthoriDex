import { db } from "../db";
import { trendingPeople } from "@shared/schema";
import { inArray } from "drizzle-orm";

const CANARY_NAMES = [
  "Donald Trump",
  "Elon Musk",
  "LeBron James",
  "Bad Bunny",
  "Cristiano Ronaldo",
  "Narendra Modi",
  "Mark Zuckerberg",
  "Kendrick Lamar",
  "Vladimir Putin",
  "Alexandria Ocasio-Cortez",
];

const CANARY_FAILURE_THRESHOLD = 4;

export interface CanaryResult {
  name: string;
  personId: string;
  newsCount: number;
  searchVolume: number;
  newsOk: boolean;
  searchOk: boolean;
}

export interface CanaryReport {
  canaryCount: number;
  resolved: number;
  newsFailures: number;
  searchFailures: number;
  newsAlert: boolean;
  searchAlert: boolean;
  failureThreshold: number;
  results: CanaryResult[];
}

let canaryIds: Map<string, string> | null = null;

async function resolveCanaryIds(): Promise<Map<string, string>> {
  if (canaryIds && canaryIds.size > 0) return canaryIds;

  const rows = await db
    .select({ id: trendingPeople.id, name: trendingPeople.name })
    .from(trendingPeople)
    .where(inArray(trendingPeople.name, CANARY_NAMES));

  canaryIds = new Map(rows.map((r) => [r.name, r.id]));
  return canaryIds;
}

export async function evaluateCanaries(
  newsData: Map<string, any>,
  serperData: Map<string, any>
): Promise<CanaryReport> {
  const idMap = await resolveCanaryIds();

  const results: CanaryResult[] = [];
  let newsFailures = 0;
  let searchFailures = 0;

  for (const [name, personId] of Array.from(idMap.entries())) {
    const news = newsData.get(personId);
    const serper = serperData.get(personId);
    const newsCount = news?.articleCount24h ?? 0;
    const searchVolume = serper?.searchVolume ?? 0;

    const newsOk = newsCount >= 2;
    const searchOk = searchVolume >= 50;

    if (!newsOk) newsFailures++;
    if (!searchOk) searchFailures++;

    results.push({ name, personId, newsCount, searchVolume, newsOk, searchOk });
  }

  const resolved = idMap.size;
  const newsAlert = newsFailures >= CANARY_FAILURE_THRESHOLD;
  const searchAlert = searchFailures >= CANARY_FAILURE_THRESHOLD;

  if (newsAlert) {
    const failed = results.filter((r) => !r.newsOk).map((r) => r.name);
    console.warn(
      `[Canary ALERT] ${newsFailures}/${resolved} canaries have near-zero news! ` +
        `Failed: ${failed.join(", ")}. Possible provider issue.`
    );
  }
  if (searchAlert) {
    const failed = results.filter((r) => !r.searchOk).map((r) => r.name);
    console.warn(
      `[Canary ALERT] ${searchFailures}/${resolved} canaries have near-zero search! ` +
        `Failed: ${failed.join(", ")}. Possible provider issue.`
    );
  }

  return {
    canaryCount: CANARY_NAMES.length,
    resolved,
    newsFailures,
    searchFailures,
    newsAlert,
    searchAlert,
    failureThreshold: CANARY_FAILURE_THRESHOLD,
    results,
  };
}

export function getCanaryNames(): string[] {
  return [...CANARY_NAMES];
}
