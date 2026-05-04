import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { celebrityImages, trendingPeople } from "@shared/schema";
import { syncWinningAvatarForPerson } from "../lib/curateAvatar";

type LeaderboardPerson = {
  id: string;
  name: string;
};

type ImageRow = typeof celebrityImages.$inferSelect;

type UpdatePlan = {
  imageId: string;
  beforeVotesUp: number;
  increment: number;
  afterVotesUp: number;
  isPrimaryBefore: boolean;
};

type PersonPlan = {
  personId: string;
  personName: string;
  isTopHalf: boolean;
  mainIncrement: number;
  updates: UpdatePlan[];
};

type Summary = {
  celebritiesProcessed: number;
  celebritiesSkippedNoImages: number;
  celebritiesUpdated: number;
  imagesUpdated: number;
  topHalfCount: number;
  bottomHalfCount: number;
  incrementMin: number;
  incrementMax: number;
};

const args = process.argv.slice(2);
const explicitDryRun = args.includes("--dry-run");
const isLive = args.includes("--live");
const dryRun = explicitDryRun || !isLive;

const seedArg = args.find((arg) => arg.startsWith("--seed="));
const seedValue = seedArg ? Number(seedArg.slice("--seed=".length)) : Date.now();

if (!Number.isFinite(seedValue)) {
  console.error("Invalid --seed value. Use a numeric seed, e.g. --seed=12345");
  process.exit(1);
}

const MAIN_INCREMENT_TOP_HALF_MIN = 13;
const MAIN_INCREMENT_TOP_HALF_MAX = 20;
const MAIN_INCREMENT_BOTTOM_HALF_MIN = 5;
const MAIN_INCREMENT_BOTTOM_HALF_MAX = 12;

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickMainIncrement(rng: () => number, isTopHalf: boolean): number {
  if (isTopHalf) {
    return randomInt(rng, MAIN_INCREMENT_TOP_HALF_MIN, MAIN_INCREMENT_TOP_HALF_MAX);
  }
  return randomInt(rng, MAIN_INCREMENT_BOTTOM_HALF_MIN, MAIN_INCREMENT_BOTTOM_HALF_MAX);
}

function orderImagesForFallback(images: ImageRow[]): ImageRow[] {
  return images.slice().sort((a, b) => {
    if (b.votesUp !== a.votesUp) return b.votesUp - a.votesUp;
    return a.addedAt.getTime() - b.addedAt.getTime();
  });
}

function buildPlanForPerson(
  personId: string,
  personName: string,
  images: ImageRow[],
  isTopHalf: boolean,
  rng: () => number,
): PersonPlan | null {
  if (images.length === 0) return null;

  const fallback = orderImagesForFallback(images)[0];
  const activeImage = images.find((img) => img.isPrimary) ?? fallback;
  if (!activeImage) return null;

  let mainIncrement = pickMainIncrement(rng, isTopHalf);
  const updates: UpdatePlan[] = [];
  const nonActivePlannedVotes: number[] = [];

  for (const image of images) {
    if (image.id === activeImage.id) {
      const afterVotesUp = image.votesUp + mainIncrement;
      updates.push({
        imageId: image.id,
        beforeVotesUp: image.votesUp,
        increment: mainIncrement,
        afterVotesUp,
        isPrimaryBefore: image.isPrimary,
      });
      continue;
    }

    const increment = Math.max(0, randomInt(rng, 0, mainIncrement - 1));
    const afterVotesUp = image.votesUp + increment;
    nonActivePlannedVotes.push(afterVotesUp);
    updates.push({
      imageId: image.id,
      beforeVotesUp: image.votesUp,
      increment,
      afterVotesUp,
      isPrimaryBefore: image.isPrimary,
    });
  }

  const activeIndex = updates.findIndex((u) => u.imageId === activeImage.id);
  if (activeIndex >= 0 && nonActivePlannedVotes.length > 0) {
    const maxNonActive = Math.max(...nonActivePlannedVotes);
    if (updates[activeIndex].afterVotesUp <= maxNonActive) {
      const extra = maxNonActive - updates[activeIndex].afterVotesUp + 1;
      updates[activeIndex].increment += extra;
      updates[activeIndex].afterVotesUp += extra;
      mainIncrement += extra;
    }
  }

  return {
    personId,
    personName,
    isTopHalf,
    mainIncrement,
    updates,
  };
}

async function fetchLeaderboardPeople(): Promise<LeaderboardPerson[]> {
  const rows = await db
    .select({
      id: trendingPeople.id,
      name: trendingPeople.name,
    })
    .from(trendingPeople)
    .where(isNotNull(trendingPeople.id))
    .orderBy(
      sql`COALESCE(${trendingPeople.fameIndexLive}, ${trendingPeople.fameIndex}) DESC NULLS LAST`,
      trendingPeople.name,
    );

  return rows;
}

async function fetchImagesByPerson(personIds: string[]): Promise<Map<string, ImageRow[]>> {
  const map = new Map<string, ImageRow[]>();
  if (personIds.length === 0) return map;

  const rows = await db
    .select()
    .from(celebrityImages)
    .where(inArray(celebrityImages.personId, personIds));

  for (const row of rows) {
    const list = map.get(row.personId) ?? [];
    list.push(row);
    map.set(row.personId, list);
  }
  return map;
}

function printPersonPreview(plan: PersonPlan): void {
  const scope = plan.isTopHalf ? "TOP" : "BOTTOM";
  console.log(
    `[${scope}] ${plan.personName} (${plan.personId}) mainIncrement=${plan.mainIncrement} images=${plan.updates.length}`,
  );
  for (const update of plan.updates) {
    const activeMarker = update.isPrimaryBefore ? "active" : "other ";
    console.log(
      `  - ${activeMarker} image=${update.imageId} votesUp ${update.beforeVotesUp} +${update.increment} => ${update.afterVotesUp}`,
    );
  }
}

async function applyPlan(plan: PersonPlan): Promise<void> {
  await db.transaction(async (tx) => {
    for (const update of plan.updates) {
      await tx
        .update(celebrityImages)
        .set({ votesUp: update.afterVotesUp })
        .where(
          and(
            eq(celebrityImages.id, update.imageId),
            eq(celebrityImages.personId, plan.personId),
          ),
        );
    }
  });
}

async function verifyPrimaryMaxVotes(personIds: string[]): Promise<Array<{ personId: string; reason: string }>> {
  if (personIds.length === 0) return [];

  const rows = await db
    .select()
    .from(celebrityImages)
    .where(inArray(celebrityImages.personId, personIds));

  const grouped = new Map<string, ImageRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.personId) ?? [];
    list.push(row);
    grouped.set(row.personId, list);
  }

  const violations: Array<{ personId: string; reason: string }> = [];
  for (const [personId, images] of grouped.entries()) {
    if (images.length === 0) continue;
    const primary = images.find((img) => img.isPrimary);
    if (!primary) {
      violations.push({ personId, reason: "No is_primary image after update" });
      continue;
    }
    const maxVotes = Math.max(...images.map((img) => img.votesUp));
    if (primary.votesUp < maxVotes) {
      violations.push({
        personId,
        reason: `Primary votes_up=${primary.votesUp}, max image votes_up=${maxVotes}`,
      });
    }
  }
  return violations;
}

function printSummary(summary: Summary): void {
  const line = "=".repeat(72);
  console.log(`\n${line}`);
  console.log("Curate seed backfill summary");
  console.log(line);
  console.log(`Celebrities processed:      ${summary.celebritiesProcessed}`);
  console.log(`Celebrities updated:        ${summary.celebritiesUpdated}`);
  console.log(`Celebrities skipped (0 img):${summary.celebritiesSkippedNoImages}`);
  console.log(`Images updated:             ${summary.imagesUpdated}`);
  console.log(`Top-half celebrities:       ${summary.topHalfCount}`);
  console.log(`Bottom-half celebrities:    ${summary.bottomHalfCount}`);
  console.log(`Increment range used:       ${summary.incrementMin}..${summary.incrementMax}`);
  console.log(line);
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("Curate Profile seed vote backfill");
  console.log(`Mode: ${dryRun ? "DRY-RUN (no DB writes)" : "LIVE (writes enabled)"}`);
  console.log(`Seed: ${seedValue}`);
  console.log("=".repeat(72));

  const rng = createSeededRng(seedValue);
  const leaderboard = await fetchLeaderboardPeople();

  if (leaderboard.length === 0) {
    console.log("No leaderboard celebrities found in trending_people. Exiting.");
    return;
  }

  const splitIndex = Math.ceil(leaderboard.length / 2);
  const personIds = leaderboard.map((p) => p.id);
  const imageMap = await fetchImagesByPerson(personIds);

  const summary: Summary = {
    celebritiesProcessed: 0,
    celebritiesSkippedNoImages: 0,
    celebritiesUpdated: 0,
    imagesUpdated: 0,
    topHalfCount: 0,
    bottomHalfCount: 0,
    incrementMin: Number.POSITIVE_INFINITY,
    incrementMax: Number.NEGATIVE_INFINITY,
  };

  const processedPersonIds: string[] = [];

  for (let i = 0; i < leaderboard.length; i++) {
    const person = leaderboard[i];
    const isTopHalf = i < splitIndex;
    const images = imageMap.get(person.id) ?? [];
    summary.celebritiesProcessed++;

    if (isTopHalf) summary.topHalfCount++;
    else summary.bottomHalfCount++;

    if (images.length === 0) {
      summary.celebritiesSkippedNoImages++;
      console.log(`[SKIP] ${person.name} (${person.id}) has no images`);
      continue;
    }

    const plan = buildPlanForPerson(person.id, person.name, images, isTopHalf, rng);
    if (!plan) {
      summary.celebritiesSkippedNoImages++;
      console.log(`[SKIP] ${person.name} (${person.id}) could not build update plan`);
      continue;
    }

    printPersonPreview(plan);

    summary.celebritiesUpdated++;
    summary.imagesUpdated += plan.updates.length;
    for (const update of plan.updates) {
      summary.incrementMin = Math.min(summary.incrementMin, update.increment);
      summary.incrementMax = Math.max(summary.incrementMax, update.increment);
    }

    if (!dryRun) {
      await applyPlan(plan);
      await syncWinningAvatarForPerson(plan.personId);
    }

    processedPersonIds.push(plan.personId);
  }

  if (summary.incrementMin === Number.POSITIVE_INFINITY) {
    summary.incrementMin = 0;
    summary.incrementMax = 0;
  }

  printSummary(summary);

  if (dryRun) {
    console.log("Dry-run complete. Re-run with --live to apply writes.");
    return;
  }

  const violations = await verifyPrimaryMaxVotes(processedPersonIds);
  if (violations.length === 0) {
    console.log("Verification passed: each celebrity primary image is max votes_up.");
    return;
  }

  console.error(`Verification failed for ${violations.length} celebrities:`);
  for (const violation of violations) {
    console.error(`  - ${violation.personId}: ${violation.reason}`);
  }
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
