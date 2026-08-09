/**
 * One-off probe: how many importable candidates survive the scout's filters
 * at various liquidity floors. Used to check the new gates don't starve the
 * daily queue. Read-only.
 *
 * Run: npx tsx --env-file=.env ops/probe-scout-yield.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function main(): Promise<void> {
  const { fetchTrendingPolymarketEvents } = await import(
    "../server/providers/polymarket"
  );

  for (const floor of [0, 500, 1000, 2500, 5000, 10000]) {
    const got = await fetchTrendingPolymarketEvents({
      limit: 120,
      minVolume24hr: floor,
    });
    const multi = got.filter((c) => c.structure === "multi").length;
    console.log(
      `floor $${String(floor).padStart(5)} → ${String(got.length).padStart(3)} candidates ` +
        `(${multi} multi, ${got.length - multi} binary)`,
    );
  }

  // Category-stratified pulls are where the thin-liquidity junk came from —
  // the global feed is volume-ranked, so its head is liquid by construction.
  console.log("\nTag-scoped pulls by liquidity floor (book ceiling always on):");
  for (const tagId of ["53", "100", "2"]) {
    const counts: string[] = [];
    for (const floor of [0, 100, 250, 500, 1000, 2500]) {
      const got = await fetchTrendingPolymarketEvents({
        limit: 120,
        tagId,
        minVolume24hr: floor,
      });
      counts.push(`$${floor}:${got.length}`);
    }
    console.log(`  tag ${tagId.padEnd(4)} ${counts.join("  ")}`);
  }

  console.log("\nWith all new caps at their defaults:");
  const dflt = await fetchTrendingPolymarketEvents({ limit: 120 });
  for (const c of dflt.slice(0, 15)) {
    console.log(
      `  $${String(Math.round(c.volume24hr)).padStart(7)}  ${c.structure.padEnd(6)} ` +
        `${String(c.outcomes.length).padStart(2)} legs  ${c.title.slice(0, 54)}`,
    );
  }
  console.log(`  … ${dflt.length} total`);
}

main().catch((err) => {
  console.error("[probe-scout-yield] failed:", err);
  process.exit(1);
});
