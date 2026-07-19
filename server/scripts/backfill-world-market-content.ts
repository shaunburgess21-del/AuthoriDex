/**
 * Backfill enriched user-facing content for scout-drafted World Markets.
 *
 * Regenerates:
 *   - summary (About / Background)
 *   - metadata.scoutWatch (What to watch)
 *   - resolutionCriteria
 *   - resolutionSources
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/backfill-world-market-content.ts
 *   npx tsx --env-file=.env server/scripts/backfill-world-market-content.ts --limit 2
 *   npx tsx --env-file=.env server/scripts/backfill-world-market-content.ts --limit=2
 *   npx tsx --env-file=.env server/scripts/backfill-world-market-content.ts --apply
 *   npx tsx --env-file=.env server/scripts/backfill-world-market-content.ts --apply --web-search
 *
 * Default is DRY-RUN (no DB writes). Pass --apply to persist.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { marketEntries, predictionMarkets } from "@shared/schema";
import { generateMarketContent } from "../services/world-market-content";

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");
const useWebSearch = args.includes("--web-search");
const delayMs = 1_200;

function parseLimit(argv: string[]): number | null {
  const eqArg = argv.find((a) => a.startsWith("--limit="));
  if (eqArg) {
    const n = Number(eqArg.slice("--limit=".length));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  const idx = argv.indexOf("--limit");
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith("--")) {
    const n = Number(argv[idx + 1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }
  return null;
}

const limit = parseLimit(args);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function preview(text: string | null | undefined, max = 160): string {
  if (!text) return "(empty)";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function shutdown(code: number) {
  try {
    await pool.end();
  } catch {
    /* ignore — Windows can assert on late handle close */
  }
  process.exit(code);
}

async function main() {
  console.log(
    `[Backfill World Market Content] Mode: ${applyMode ? "APPLY" : "DRY-RUN"}${useWebSearch ? " + web-search" : ""}`,
  );
  if (limit != null) {
    console.log(`[Backfill] Limit: ${limit}`);
  }

  const rows = await db
    .select({
      id: predictionMarkets.id,
      title: predictionMarkets.title,
      slug: predictionMarkets.slug,
      category: predictionMarkets.category,
      teaser: predictionMarkets.teaser,
      summary: predictionMarkets.summary,
      resolutionCriteria: predictionMarkets.resolutionCriteria,
      resolutionSources: predictionMarkets.resolutionSources,
      visibility: predictionMarkets.visibility,
      metadata: predictionMarkets.metadata,
    })
    .from(predictionMarkets)
    .where(
      and(
        eq(predictionMarkets.marketType, "community"),
        sql`${predictionMarkets.metadata}->>'scoutedByMarketScout' = 'true'`,
      ),
    )
    .orderBy(asc(predictionMarkets.createdAt));

  const targets = limit != null ? rows.slice(0, limit) : rows;

  console.log(
    `[Backfill] Found ${rows.length} scout-drafted community markets; processing ${targets.length}`,
  );

  // Batch-load entry labels to avoid N+1 queries.
  const entryLabelsByMarket = new Map<string, string[]>();
  if (targets.length > 0) {
    const entryRows = await db
      .select({
        marketId: marketEntries.marketId,
        label: marketEntries.label,
        displayOrder: marketEntries.displayOrder,
      })
      .from(marketEntries)
      .where(
        inArray(
          marketEntries.marketId,
          targets.map((t) => t.id),
        ),
      )
      .orderBy(asc(marketEntries.displayOrder));

    for (const e of entryRows) {
      const list = entryLabelsByMarket.get(e.marketId) ?? [];
      list.push(e.label);
      entryLabelsByMarket.set(e.marketId, list);
    }
  }

  let wrote = 0;
  let dryRunOk = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const m = targets[i];
    const meta = (m.metadata && typeof m.metadata === "object"
      ? m.metadata
      : {}) as Record<string, unknown>;
    const source = (meta.source && typeof meta.source === "object"
      ? meta.source
      : {}) as Record<string, unknown>;
    const rulesText =
      typeof source.resolutionRulesText === "string"
        ? source.resolutionRulesText
        : null;
    const existingWatch =
      typeof meta.scoutWatch === "string" ? meta.scoutWatch : null;
    const entryLabels = entryLabelsByMarket.get(m.id) ?? [];

    console.log(
      `\n[${i + 1}/${targets.length}] ${m.visibility} · ${m.slug}\n  title: ${m.title}`,
    );
    console.log(`  before summary: ${preview(m.summary)}`);
    console.log(`  before watch:   ${preview(existingWatch)}`);
    console.log(
      `  before sources: ${Array.isArray(m.resolutionSources) ? m.resolutionSources.length : 0}`,
    );

    try {
      const generated = await generateMarketContent(
        {
          title: m.title,
          category: m.category,
          teaser: m.teaser,
          entryLabels,
          rulesText,
          existingCriteria: m.resolutionCriteria,
        },
        { useWebSearch },
      );

      console.log(`  after summary:  ${preview(generated.summary)}`);
      console.log(`  after watch:    ${preview(generated.scoutWatch)}`);
      console.log(
        `  after criteria: ${generated.resolutionCriteria.join(" | ") || "(none)"}`,
      );
      console.log(
        `  after sources:  ${
          generated.resolutionSources
            ?.map((s) => (s.url ? `${s.label} <${s.url}>` : s.label))
            .join(" | ") || "(none)"
        }`,
      );

      if (!applyMode) {
        dryRunOk += 1;
      } else {
        const watchSql = generated.scoutWatch
          ? sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) || ${JSON.stringify({ scoutWatch: generated.scoutWatch })}::jsonb`
          : sql`COALESCE(${predictionMarkets.metadata}, '{}'::jsonb) - 'scoutWatch'`;

        await db
          .update(predictionMarkets)
          .set({
            summary: generated.summary,
            resolutionCriteria:
              generated.resolutionCriteria.length > 0
                ? generated.resolutionCriteria
                : m.resolutionCriteria,
            resolutionSources: generated.resolutionSources,
            metadata: watchSql,
            updatedAt: new Date(),
          })
          .where(eq(predictionMarkets.id, m.id));
        wrote += 1;
        console.log("  → wrote");
      }
    } catch (err) {
      failed += 1;
      console.error(
        `  → FAILED: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (i < targets.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log("\n[Backfill] Done.");
  console.log(
    `  processed=${targets.length} wrote=${wrote} dryRunOk=${dryRunOk} failed=${failed}`,
  );
}

main()
  .then(() => shutdown(0))
  .catch(async (err) => {
    console.error("[Backfill] Fatal:", err);
    await shutdown(1);
  });
