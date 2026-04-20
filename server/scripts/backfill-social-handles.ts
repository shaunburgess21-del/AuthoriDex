/**
 * Backfill Instagram / TikTok / YouTube / Spotify (and optionally X) handles
 * on tracked_people via Wikidata.
 *
 * Strategy per person:
 *   1. Resolve Wikidata QID — primary: via wikiSlug through the Wikipedia
 *      pageprops API; fallback: Wikidata wbsearchentities by name.
 *   2. Fetch the entity's claims JSON from Wikidata.
 *   3. Extract values for the Wikidata properties we care about, normalise
 *      them, and write them to tracked_people **only if the existing DB
 *      column is null**. We never overwrite curated data.
 *
 * Rate limit: one external request per second, with a descriptive
 * User-Agent header (required by Wikimedia's API etiquette).
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/backfill-social-handles.ts
 *   npx tsx --env-file=.env server/scripts/backfill-social-handles.ts --dry-run
 *   npx tsx --env-file=.env server/scripts/backfill-social-handles.ts --only="Elon Musk"
 */

import { db, pool } from "../db";
import { trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";

type PlatformKey = "instagramHandle" | "tiktokHandle" | "youtubeId" | "spotifyId" | "xHandle";

const WIKIDATA_PROPS: Record<string, PlatformKey> = {
  P2003: "instagramHandle",
  P7085: "tiktokHandle",
  P2397: "youtubeId",
  P1902: "spotifyId",
  P2002: "xHandle",
};

const USER_AGENT = "AuthoriDex-backfill/1.0 (https://authoridex.app; backfill-script)";
const REQUEST_INTERVAL_MS = 1000;

// ---------- CLI args ----------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find(a => a.startsWith("--only="));
const onlyName = onlyArg ? onlyArg.slice("--only=".length).replace(/^"|"$/g, "").trim() : null;

// ---------- Rate limiter ----------

let lastRequestAt = 0;
async function rateLimitedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const now = Date.now();
  const wait = lastRequestAt + REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  headers.set("Accept", "application/json");
  return fetch(url, { ...init, headers });
}

// ---------- Normalisation helpers ----------

function stripAt(raw: string): string {
  return raw.trim().replace(/^@+/, "");
}

function validYouTubeChannelId(raw: string): boolean {
  return /^UC[A-Za-z0-9_-]{22}$/.test(raw);
}

function validSpotifyId(raw: string): boolean {
  return /^[A-Za-z0-9]{22}$/.test(raw);
}

function normalise(prop: string, raw: string): string | null {
  const key = WIKIDATA_PROPS[prop];
  if (!key) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  switch (key) {
    case "instagramHandle":
    case "tiktokHandle":
    case "xHandle":
      return stripAt(trimmed);
    case "youtubeId":
      return validYouTubeChannelId(trimmed) ? trimmed : null;
    case "spotifyId":
      return validSpotifyId(trimmed) ? trimmed : null;
  }
}

// ---------- Wikipedia -> QID ----------

async function resolveQidFromWikiSlug(wikiSlug: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(wikiSlug)}&format=json&redirects=1`;
  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      query?: { pages?: Record<string, { pageprops?: { wikibase_item?: string } }> };
    };
    const pages = data.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const qid = page.pageprops?.wikibase_item;
      if (qid && /^Q\d+$/.test(qid)) return qid;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveQidByName(name: string): Promise<{ qid: string; description?: string } | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`;
  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      search?: Array<{ id?: string; description?: string; match?: { type?: string } }>;
    };
    const hit = data.search?.[0];
    if (hit?.id && /^Q\d+$/.test(hit.id)) {
      return { qid: hit.id, description: hit.description };
    }
    return null;
  } catch {
    return null;
  }
}

// ---------- Wikidata entity -> claims ----------

type ClaimRank = "preferred" | "normal" | "deprecated";
type Claim = {
  rank?: ClaimRank;
  mainsnak?: { datavalue?: { value?: unknown; type?: string } };
};
type EntityData = {
  entities?: Record<string, { claims?: Record<string, Claim[]> }>;
};

// Wikidata supports multiple values per property with ranks. The
// recommended consumer behaviour is: use "preferred" values when present,
// otherwise fall back to "normal", and never use "deprecated" values.
// Without this, we were picking whatever Wikidata ordered first, which
// occasionally surfaced a fan account over the person's real profile.
function sortClaimsByRank(claims: Claim[]): Claim[] {
  const rank = (c: Claim): number =>
    c.rank === "preferred" ? 0 : c.rank === "deprecated" ? 2 : 1;
  return claims
    .filter(c => c.rank !== "deprecated")
    .slice()
    .sort((a, b) => rank(a) - rank(b));
}

async function fetchEntityClaims(qid: string): Promise<Record<string, Claim[]> | null> {
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as EntityData;
    return data.entities?.[qid]?.claims ?? null;
  } catch {
    return null;
  }
}

function claimToString(claim: Claim): string | null {
  const dv = claim.mainsnak?.datavalue;
  if (!dv) return null;
  if (typeof dv.value === "string") return dv.value;
  return null;
}

// ---------- Build patch respecting null-only rule ----------

type Person = typeof trackedPeople.$inferSelect;

function buildPatch(
  person: Person,
  claims: Record<string, Claim[]>,
): Partial<Record<PlatformKey, string>> {
  const patch: Partial<Record<PlatformKey, string>> = {};
  for (const [prop, key] of Object.entries(WIKIDATA_PROPS) as Array<[string, PlatformKey]>) {
    if (person[key]) continue; // null-only write
    const rawClaims = claims[prop];
    if (!rawClaims || rawClaims.length === 0) continue;
    for (const c of sortClaimsByRank(rawClaims)) {
      const raw = claimToString(c);
      if (!raw) continue;
      const normalised = normalise(prop, raw);
      if (normalised) {
        patch[key] = normalised;
        break;
      }
    }
  }
  return patch;
}

// ---------- Coverage tracking ----------

type Stats = {
  total: number;
  qidViaSlug: number;
  qidViaSearch: number;
  qidNotFound: string[];
  filled: Record<PlatformKey, number>;
  alreadySet: Record<PlatformKey, number>;
  missingAfter: Record<PlatformKey, string[]>;
  zeroFillAfter: string[];
  patched: Array<{ name: string; patch: Partial<Record<PlatformKey, string>> }>;
};

function emptyPlatformMap<T>(fill: () => T): Record<PlatformKey, T> {
  return {
    instagramHandle: fill(),
    tiktokHandle: fill(),
    youtubeId: fill(),
    spotifyId: fill(),
    xHandle: fill(),
  };
}

// ---------- Main ----------

async function main() {
  console.log("=".repeat(70));
  console.log("Wikidata social-handles backfill");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB writes)" : "LIVE"}`);
  if (onlyName) console.log(`Filter: --only="${onlyName}"`);
  console.log("=".repeat(70));

  const allPeople = await db.select().from(trackedPeople);
  const people = onlyName
    ? allPeople.filter(p => p.name.toLowerCase() === onlyName.toLowerCase())
    : allPeople;

  if (onlyName && people.length === 0) {
    console.error(`No person found matching --only="${onlyName}". Exiting.`);
    return;
  }

  console.log(`Processing ${people.length} of ${allPeople.length} tracked people\n`);

  const stats: Stats = {
    total: people.length,
    qidViaSlug: 0,
    qidViaSearch: 0,
    qidNotFound: [],
    filled: emptyPlatformMap(() => 0),
    alreadySet: emptyPlatformMap(() => 0),
    missingAfter: emptyPlatformMap<string[]>(() => []),
    zeroFillAfter: [],
    patched: [],
  };

  // Count pre-existing fills.
  for (const p of people) {
    for (const key of Object.values(WIKIDATA_PROPS)) {
      if (p[key]) stats.alreadySet[key]++;
    }
  }

  let i = 0;
  for (const person of people) {
    i++;
    const prefix = `[${i}/${people.length}] ${person.name}`;

    let qid: string | null = null;
    if (person.wikiSlug) {
      qid = await resolveQidFromWikiSlug(person.wikiSlug);
      if (qid) stats.qidViaSlug++;
    }
    if (!qid) {
      const searchHit = await resolveQidByName(person.name);
      if (searchHit) {
        qid = searchHit.qid;
        stats.qidViaSearch++;
        console.log(`${prefix}: QID resolved via name search -> ${qid}${searchHit.description ? ` (${searchHit.description})` : ""}`);
      }
    }

    if (!qid) {
      stats.qidNotFound.push(person.name);
      console.log(`${prefix}: QID not found`);
      continue;
    }

    const claims = await fetchEntityClaims(qid);
    if (!claims) {
      console.log(`${prefix}: failed to fetch entity ${qid}`);
      continue;
    }

    const patch = buildPatch(person, claims);

    if (Object.keys(patch).length === 0) {
      stats.zeroFillAfter.push(person.name);
      console.log(`${prefix}: ${qid} -> no new fields`);
      continue;
    }

    stats.patched.push({ name: person.name, patch });
    for (const key of Object.keys(patch) as PlatformKey[]) {
      stats.filled[key]++;
    }

    const summary = Object.entries(patch)
      .map(([k, v]) => `${k.replace("Handle", "").replace("Id", "")}=${v}`)
      .join(", ");
    console.log(`${prefix}: ${qid} -> ${summary}`);

    if (!dryRun) {
      await db.update(trackedPeople).set(patch).where(eq(trackedPeople.id, person.id));
    }
  }

  // Tally missing-after for the report (post-patch view).
  for (const p of people) {
    const finalView: Record<PlatformKey, string | null> = {
      instagramHandle: p.instagramHandle ?? null,
      tiktokHandle: p.tiktokHandle ?? null,
      youtubeId: p.youtubeId ?? null,
      spotifyId: p.spotifyId ?? null,
      xHandle: p.xHandle ?? null,
    };
    const patched = stats.patched.find(x => x.name === p.name);
    if (patched) {
      for (const [k, v] of Object.entries(patched.patch) as Array<[PlatformKey, string]>) {
        finalView[k] = v;
      }
    }
    for (const key of Object.values(WIKIDATA_PROPS)) {
      if (!finalView[key]) stats.missingAfter[key].push(p.name);
    }
  }

  printReport(stats);
}

// ---------- Report ----------

function printReport(stats: Stats) {
  const line = "-".repeat(70);
  console.log(`\n${line}`);
  console.log("COVERAGE REPORT");
  console.log(line);
  console.log(`Total people processed: ${stats.total}`);
  console.log(`\nQID resolution:`);
  console.log(`  via wikiSlug:     ${stats.qidViaSlug}`);
  console.log(`  via name search:  ${stats.qidViaSearch}`);
  console.log(`  not found:        ${stats.qidNotFound.length}`);

  console.log(`\nPer-platform fills:`);
  for (const key of Object.values(WIKIDATA_PROPS)) {
    const newlyFilled = stats.filled[key];
    const alreadySet = stats.alreadySet[key];
    const stillMissing = stats.missingAfter[key].length;
    const total = stats.total;
    const coverage = total > 0 ? Math.round(((alreadySet + newlyFilled) / total) * 100) : 0;
    console.log(
      `  ${key.padEnd(17)} newly=${String(newlyFilled).padStart(3)}  already=${String(alreadySet).padStart(3)}  missing=${String(stillMissing).padStart(3)}  coverage=${coverage}%`,
    );
  }

  if (stats.qidNotFound.length > 0) {
    console.log(`\nQID not found (needs manual Wikidata lookup or manual handle entry):`);
    for (const name of stats.qidNotFound) console.log(`  - ${name}`);
  }

  if (stats.zeroFillAfter.length > 0) {
    console.log(`\nWikidata had the person but no social properties (typical for internet-native creators):`);
    for (const name of stats.zeroFillAfter) console.log(`  - ${name}`);
  }

  // List people still missing each platform (useful for targeted manual fill).
  for (const key of Object.values(WIKIDATA_PROPS)) {
    const list = stats.missingAfter[key];
    if (list.length === 0 || list.length === stats.total) continue;
    console.log(`\nStill missing ${key} (${list.length}):`);
    for (const name of list.slice(0, 20)) console.log(`  - ${name}`);
    if (list.length > 20) console.log(`  ... and ${list.length - 20} more`);
  }

  console.log(`\n${line}`);
  if (dryRun) {
    console.log("DRY-RUN complete. No DB writes were made.");
  } else {
    console.log(`Done. Patched ${stats.patched.length} people.`);
  }
  console.log(line);
}

main()
  .catch(err => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
