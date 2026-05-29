// Live validation for the DataForSEO clickstream search-volume mass signal.
//
// Run AFTER setting DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in .env:
//   npx tsx --env-file=.env server/scripts/validate-search-volume.ts
//
// Fetches estimated monthly search volume (clickstream) for the current roster
// and prints it sorted desc, so you can eyeball disambiguation (a wrong keyword
// usually shows up as an implausibly huge or zero volume) BEFORE trusting the
// mass blend in production. No scores are written; this is read-only.

import { db } from "../db";
import { trendingPeople } from "@shared/schema";
import {
  fetchSearchVolumeBatch,
  isDataForSeoConfigured,
  getDataForSeoRunStats,
  resetDataForSeoRunStats,
} from "../providers/dataforseo";
import { normalizeSearchVolumeMass } from "../scoring/normalize";

async function main() {
  if (!isDataForSeoConfigured()) {
    console.error("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set. Add them to .env and re-run with --env-file=.env");
    process.exit(1);
  }

  const people = await db
    .select({ id: trendingPeople.id, name: trendingPeople.name })
    .from(trendingPeople);

  console.log(`Fetching search volume for ${people.length} people...\n`);
  resetDataForSeoRunStats();
  const t0 = Date.now();
  const volumes = await fetchSearchVolumeBatch(
    people.map((p) => ({ personId: p.id, name: p.name })),
  );
  const stats = getDataForSeoRunStats();

  const rows = people
    .map((p) => {
      const datum = volumes.get(p.id);
      const vol = datum?.volume ?? 0;
      return { name: p.name, vol, mom: datum?.momDeltaPct ?? 0, mass: normalizeSearchVolumeMass(vol) };
    })
    .sort((a, b) => b.vol - a.vol);

  const withData = rows.filter((r) => r.vol > 0).length;
  const zero = rows.length - withData;

  console.log("RANK  MONTHLY SEARCHES   MASS(0-100)   MoM%   NAME");
  console.log("----  ----------------   -----------   ----   --------------------------------");
  rows.forEach((r, i) => {
    const mom = r.vol > 0 ? `${r.mom >= 0 ? "+" : ""}${Math.round(r.mom)}` : "";
    console.log(
      `${String(i + 1).padStart(4)}  ${String(r.vol).padStart(16)}   ${r.mass.toFixed(1).padStart(11)}   ${mom.padStart(5)}   ${r.name}`,
    );
  });

  console.log(`\n── Summary ─────────────────────────────────────────────`);
  console.log(`people with volume : ${withData}/${rows.length}`);
  console.log(`zero/no data       : ${zero}`);
  console.log(`API calls          : ${stats.callsAttempted} (failures ${stats.finalFailures})`);
  console.log(`spend this run     : $${stats.totalCostUsd}`);
  console.log(`elapsed            : ${Date.now() - t0}ms`);
  console.log(`\nEyeball check: scan the top + bottom for any name whose volume looks`);
  console.log(`wrong (shares a name with a brand/place, or famous-but-zero). For those,`);
  console.log(`set the person's searchQueryOverride to disambiguate.`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Validation failed:", e);
  process.exit(1);
});
