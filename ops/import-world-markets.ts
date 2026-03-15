/**
 * Import World Markets from the curated XLSX spreadsheet.
 *
 * Usage:
 *   npx tsx ops/import-world-markets.ts --dry-run          # validate only
 *   npx tsx ops/import-world-markets.ts                    # real import
 *   npx tsx ops/import-world-markets.ts --file other.xlsx  # custom file
 *
 * Requires the server to be running (calls the admin API).
 * Set ADMIN_TOKEN env var to a valid admin session token.
 */

import XLSX from "xlsx";
import path from "path";

const DEFAULT_FILE = path.resolve(__dirname, "authoridex_world_markets_launch_top25_final.xlsx");
const SHEET_NAME = "Import_Top_25";
const API_BASE = process.env.API_BASE || "http://localhost:5000";

const CATEGORY_NORMALIZE: Record<string, string> = {
  "tech / business": "tech",
  "tech/business": "tech",
  "creators": "creator",
};

interface RawRow {
  Rank: number;
  "Live Recommendation": string;
  Type: string;
  "Title / Question": string;
  Slug: string;
  Teaser: string;
  Category: string;
  "Linked Person": string;
  "Resolution Date": string | number | Date;
  "Resolution Criteria": string;
  "Option 1": string; "Seed 1": number;
  "Option 2": string; "Seed 2": number;
  "Option 3"?: string; "Seed 3"?: number;
  "Option 4"?: string; "Seed 4"?: number;
  "Option 5"?: string; "Seed 5"?: number;
  "Time Horizon": string;
  "Fit Score": number;
  "Settlement Difficulty": string;
  "Source / Note": string;
}

function parseDate(val: string | number | Date): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (d) return new Date(d.y, d.m - 1, d.d).toISOString();
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCategory(cat: string): string {
  const lower = cat.trim().toLowerCase();
  return CATEGORY_NORMALIZE[lower] || lower;
}

function buildUpDownFields(row: RawRow): { underlying?: string; metric?: string; strike?: number; unit?: string } {
  const title = row["Title / Question"] || "";
  if (title.includes("Bitcoin")) return { underlying: "Bitcoin", metric: "Price", strike: 100000, unit: "$" };
  if (title.includes("Tesla")) return { underlying: "Tesla (TSLA)", metric: "Price", strike: 400, unit: "$" };
  return {};
}

function rowToPayload(row: RawRow) {
  const type = row.Type?.trim();
  const normalizedType = type === "Up/Down" ? "updown" : type?.toLowerCase();

  const entries: { label: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const label = row[`Option ${i}` as keyof RawRow] as string | undefined;
    if (label?.toString().trim()) {
      entries.push({ label: label.toString().trim() });
    }
  }

  const updown = normalizedType === "updown" ? buildUpDownFields(row) : {};

  return {
    title: row["Title / Question"]?.trim(),
    slug: row.Slug?.trim(),
    type: normalizedType,
    teaser: row.Teaser?.trim() || null,
    category: normalizeCategory(row.Category || "misc"),
    linkedPerson: row["Linked Person"]?.trim() || null,
    resolutionDate: parseDate(row["Resolution Date"]),
    resolutionCriteria: row["Resolution Criteria"]?.trim() || null,
    entries,
    sourceNote: row["Source / Note"]?.trim() || null,
    fitScore: row["Fit Score"] || null,
    settlementDifficulty: row["Settlement Difficulty"]?.trim() || null,
    timeHorizon: row["Time Horizon"]?.trim() || null,
    launchWave: row["Live Recommendation"]?.trim() || null,
    ...updown,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const filePath = fileIdx >= 0 && args[fileIdx + 1] ? path.resolve(args[fileIdx + 1]) : DEFAULT_FILE;

  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    console.error("ERROR: Set ADMIN_TOKEN env var to a valid admin session token.");
    console.error("  You can copy it from your browser's cookie or Authorization header.");
    process.exit(1);
  }

  console.log(`Reading: ${filePath}`);
  console.log(`Sheet:   ${SHEET_NAME}`);
  console.log(`Mode:    ${dryRun ? "DRY RUN (no inserts)" : "LIVE IMPORT"}`);
  console.log();

  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found. Available: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<RawRow>(ws);
  console.log(`Parsed ${rows.length} rows from spreadsheet.\n`);

  const markets = rows.map(rowToPayload);

  const url = `${API_BASE}/api/admin/open-markets/import${dryRun ? "?dryRun=true" : ""}`;
  console.log(`POST ${url}\n`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ markets }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`HTTP ${resp.status}: ${text}`);
    process.exit(1);
  }

  const result = await resp.json();

  console.log("═══════════════════════════════════════════════════");
  console.log(`  ${dryRun ? "DRY RUN" : "IMPORT"} SUMMARY`);
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Total:   ${result.total}`);
  console.log(`  Created: ${result.created}`);
  console.log(`  Skipped: ${result.skipped}`);
  console.log(`  Errors:  ${result.errors}`);
  console.log("═══════════════════════════════════════════════════\n");

  for (const r of result.results) {
    const icon = r.status === "created" ? "✓" : r.status === "skipped" ? "–" : "✗";
    console.log(`${icon} [${r.index + 1}] ${r.title} (${r.slug}) → ${r.status}`);
    for (const m of r.messages) {
      const prefix = m.severity === "error" ? "  ✗ ERROR" : m.severity === "warning" ? "  ⚠ WARN " : "  ℹ INFO ";
      console.log(`${prefix}: ${m.field ? `[${m.field}] ` : ""}${m.message}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
