/**
 * Diagnose why Serper News contributes 0 articles for some people in the
 * union, even though a raw 24h Serper query returns results for them.
 *
 * Fetches page 1 of the real 24h query for each name, then applies the exact
 * relevance filter the provider applies (`buildSerperRelevanceSpec` +
 * `articleMatchesRelevance`), and prints which articles survive and which are
 * dropped. Read-only: hits Serper and nothing else, writes no cache and no DB.
 *
 * Run: npx tsx --env-file=.env ops/probe-serper-relevance-filter.ts
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const NAMES = [
  "Timothée Chalamet",
  "Michael Saylor",
  "Theo Von",
  "Satya Nadella",
  "Charli D'Amelio",
  "Adin Ross",
  "Tony Hinchcliffe",
  "Chamath Palihapitiya",
  "Donald Trump", // control — known to work in production
];

async function main(): Promise<void> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY not set");

  const { buildSerperNewsQuery, buildSerperRelevanceSpec, articleMatchesRelevance } =
    await import("../server/providers/serper-news-parse");

  console.log("\nSerper News relevance-filter probe (24h, page 1)\n");

  for (const name of NAMES) {
    const query = buildSerperNewsQuery(name);
    const spec = buildSerperRelevanceSpec(query);

    const res = await fetch("https://google.serper.dev/news", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 10, page: 1, tbs: "qdr:d" }),
    });
    const json: any = await res.json().catch(() => null);
    const raw: any[] = json?.news ?? [];

    const kept = raw.filter((a) => articleMatchesRelevance(a.title, a.snippet, spec));
    const dropped = raw.filter((a) => !articleMatchesRelevance(a.title, a.snippet, spec));

    const specDesc =
      spec.allOf.length > 0
        ? `allOf=[${spec.allOf.join(", ")}]`
        : `anyOf=${JSON.stringify(spec.anyOf)}`;

    console.log(`── ${name}`);
    console.log(`   query="${query}"  ${specDesc}`);
    console.log(`   raw=${raw.length}  kept=${kept.length}  dropped=${dropped.length}`);
    for (const a of dropped.slice(0, 3)) {
      console.log(`     DROPPED: ${String(a.title ?? "").slice(0, 100)}`);
    }
    console.log();

    await new Promise((r) => setTimeout(r, 400));
  }
}

main().catch((err) => {
  console.error("probe failed:", err);
  process.exit(1);
});
