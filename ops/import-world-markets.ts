/**
 * Import World Markets from the curated Excel spreadsheet.
 *
 * Usage:
 *   npx tsx ops/import-world-markets.ts --dry-run          # validate only
 *   npx tsx ops/import-world-markets.ts                    # real import
 *   npx tsx ops/import-world-markets.ts --file other.xlsx  # custom file
 *
 * Requires the server to be running (calls the admin API).
 * Set ADMIN_TOKEN env var to a valid admin session token.
 */

import ExcelJS from "exceljs";
import path from "path";

const DEFAULT_FILE = path.resolve(__dirname, "authoridex_world_markets_launch_top25_final.xlsx");
const SHEET_NAME = "Import_Top_25";
const API_BASE = process.env.API_BASE || "http://localhost:5000";

const CATEGORY_NORMALIZE: Record<string, string> = {
  "tech / business": "tech",
  "tech/business": "tech",
  "creators": "creator",
};

type CellValue = string | number | Date | null;

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

function parseExcelSerialDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const millis = Math.round(serial * 24 * 60 * 60 * 1000);
  return new Date(excelEpoch + millis);
}

function parseDate(val: CellValue): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "number") {
    const parsed = parseExcelSerialDate(val);
    if (parsed && !isNaN(parsed.getTime())) return parsed.toISOString();
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

function getCellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result != null) return String(value.result);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return "";
  }
  return String(value);
}

async function readSheetRows(filePath: string, sheetName: string): Promise<RawRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found. Available: ${workbook.worksheets.map((s) => s.name).join(", ")}`);
  }

  const headerRow = worksheet.getRow(1);
  const headers = new Map<number, string>();
  headerRow.eachCell((cell, colNumber) => {
    headers.set(colNumber, getCellText(cell.value).trim());
  });

  const rows: RawRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, CellValue> = {};
    let hasData = false;
    headers.forEach((header, colNumber) => {
      if (!header) return;
      const cell = row.getCell(colNumber);
      const raw = cell.value;
      if (raw == null || raw === "") {
        record[header] = null;
        return;
      }
      hasData = true;
      if (raw instanceof Date || typeof raw === "number") {
        record[header] = raw;
      } else {
        record[header] = getCellText(raw).trim();
      }
    });
    if (hasData) rows.push(record as unknown as RawRow);
  });

  return rows;
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

  const rows = await readSheetRows(filePath, SHEET_NAME);
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
