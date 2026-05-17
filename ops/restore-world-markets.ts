/**
 * Restore World (community) markets after the parimutuel sunset wipe.
 *
 * The parimutuel sunset wipe (scripts/sunset-wipe-parimutuel.ts) deleted
 * every non-jackpot row where engine='parimutuel'. Community markets
 * still had engine='parimutuel' at that moment (the AMM_COMMUNITY_FLIP
 * flag was never set in production) so they were collateral damage.
 *
 * This script re-imports the curated launch spreadsheet directly into
 * the DB as AMM-engine community markets, mirroring the production
 * importer route (POST /api/admin/open-markets/import) but without
 * needing a running server or admin token.
 *
 * Usage:
 *   npx tsx ops/restore-world-markets.ts --dry-run
 *   npx tsx ops/restore-world-markets.ts
 *   npx tsx ops/restore-world-markets.ts --file <path-to-xlsx>
 *   npx tsx ops/restore-world-markets.ts --bump-past-days 30
 *
 * Flags:
 *   --dry-run             Validate + print plan, no DB writes.
 *   --file <path>         XLSX path. Default order:
 *                           1. ops/authoridex_world_markets_launch_top25_final.xlsx
 *                           2. %USERPROFILE%/Downloads/authoridex_world_markets_launch_top25_final.xlsx
 *   --bump-past-days N    For rows whose resolutionDate is in the past,
 *                         shift to today + N days. Default 30. Set to 0
 *                         to skip past-dated rows instead.
 *
 * Created markets are inserted as:
 *   visibility = 'draft'
 *   isLive     = false
 *   status     = 'OPEN'
 *   engine     = 'amm'
 *
 * Review them in Admin > Predictions > World Markets > Draft filter,
 * then bulk-publish via the "Publish [N]" button (or call the
 * batch-visibility admin route).
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function getStringArg(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const raw = args[idx + 1];
  if (raw == null || raw.startsWith("--")) {
    console.error(`\n[restore:world-markets] ${flag} requires a value.`);
    process.exit(1);
  }
  return raw;
}

function parseNonNegInt(flag: string, fallback: number): number {
  const idx = args.indexOf(flag);
  if (idx < 0) return fallback;
  const raw = args[idx + 1];
  if (raw == null) {
    console.error(`\n[restore:world-markets] ${flag} requires a numeric value.`);
    process.exit(1);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`\n[restore:world-markets] Invalid value for ${flag}: "${raw}". Expected a non-negative number.`);
    process.exit(1);
  }
  return Math.floor(n);
}

const FILE_ARG = getStringArg("--file");
const BUMP_PAST_DAYS = parseNonNegInt("--bump-past-days", 30);

const DEFAULT_FILES = [
  path.resolve(process.cwd(), "ops/authoridex_world_markets_launch_top25_final.xlsx"),
  process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "Downloads", "authoridex_world_markets_launch_top25_final.xlsx")
    : null,
  process.env.HOME
    ? path.join(process.env.HOME, "Downloads", "authoridex_world_markets_launch_top25_final.xlsx")
    : null,
].filter(Boolean) as string[];

function resolveFile(): string {
  if (FILE_ARG) {
    const p = path.resolve(FILE_ARG);
    if (!existsSync(p)) throw new Error(`File not found: ${p}`);
    return p;
  }
  for (const candidate of DEFAULT_FILES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "No xlsx file found. Pass --file <path> or place the file at one of:\n  " +
      DEFAULT_FILES.join("\n  "),
  );
}

const SHEET_NAME = "Import_Top_25";

const CATEGORY_NORMALIZE: Record<string, string> = {
  "tech / business": "tech",
  "tech/business": "tech",
  creators: "creator",
};

const VALID_TYPES = ["binary", "multi", "updown"];
// Case-insensitive lookup so categories like "Film & TV" / "Food & Drink" /
// "Lifestyle" don't false-trigger the warning after the lowercase pass.
const VALID_CATEGORIES_LOWER = new Set(
  ["politics", "tech", "music", "sports", "business", "creator",
   "Film & TV", "gaming", "misc", "Food & Drink", "Lifestyle"].map((c) => c.toLowerCase()),
);
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type CellValue = string | number | Date | null;

interface RawRow {
  [key: string]: CellValue | undefined;
}

interface RowPayload {
  title: string;
  slug: string;
  type: string;
  teaser: string | null;
  category: string | null;
  linkedPerson: string | null;
  resolutionDate: string | null;
  resolutionCriteria: string | null;
  entries: { label: string }[];
  sourceNote: string | null;
  fitScore: number | null;
  settlementDifficulty: string | null;
  timeHorizon: string | null;
  launchWave: string | null;
  underlying?: string;
  metric?: string;
  strike?: number;
  unit?: string;
}

function parseExcelSerialDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const millis = Math.round(serial * 24 * 60 * 60 * 1000);
  return new Date(excelEpoch + millis);
}

function parseDate(val: CellValue | undefined): string | null {
  if (val == null || val === "") return null;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "number") {
    const parsed = parseExcelSerialDate(val);
    if (parsed && !isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeCategory(cat: string): string {
  const lower = cat.trim().toLowerCase();
  return CATEGORY_NORMALIZE[lower] || lower;
}

function buildUpDownFields(title: string): { underlying?: string; metric?: string; strike?: number; unit?: string } {
  if (title.includes("Bitcoin")) return { underlying: "Bitcoin", metric: "Price", strike: 100000, unit: "$" };
  if (title.includes("Tesla")) return { underlying: "Tesla (TSLA)", metric: "Price", strike: 400, unit: "$" };
  return {};
}

function rowToPayload(row: RawRow): RowPayload {
  const type = (row.Type as string | undefined)?.trim() ?? "";
  const normalizedType = type === "Up/Down" ? "updown" : type.toLowerCase();
  const title = ((row["Title / Question"] as string | undefined) ?? "").toString().trim();

  const entries: { label: string }[] = [];
  for (let i = 1; i <= 5; i++) {
    const label = row[`Option ${i}`];
    if (label != null && String(label).trim() !== "") {
      entries.push({ label: String(label).trim() });
    }
  }

  const updown = normalizedType === "updown" ? buildUpDownFields(title) : {};

  return {
    title,
    slug: ((row.Slug as string | undefined) ?? "").toString().trim(),
    type: normalizedType,
    teaser: ((row.Teaser as string | undefined) ?? "").toString().trim() || null,
    category: normalizeCategory(((row.Category as string | undefined) ?? "misc").toString()),
    linkedPerson: ((row["Linked Person"] as string | undefined) ?? "").toString().trim() || null,
    resolutionDate: parseDate(row["Resolution Date"]),
    resolutionCriteria: ((row["Resolution Criteria"] as string | undefined) ?? "").toString().trim() || null,
    entries,
    sourceNote: ((row["Source / Note"] as string | undefined) ?? "").toString().trim() || null,
    fitScore: row["Fit Score"] != null && !isNaN(Number(row["Fit Score"])) ? Number(row["Fit Score"]) : null,
    settlementDifficulty: ((row["Settlement Difficulty"] as string | undefined) ?? "").toString().trim() || null,
    timeHorizon: ((row["Time Horizon"] as string | undefined) ?? "").toString().trim() || null,
    launchWave: ((row["Live Recommendation"] as string | undefined) ?? "").toString().trim() || null,
    ...updown,
  };
}

async function readSheetRows(filePath: string, sheetName: string): Promise<RawRow[]> {
  // SheetJS reads more xlsx variants cleanly than ExcelJS (which chokes on
  // some defined-name structures with "Cannot read properties of undefined
  // (reading 'name')"). We pin to the patched 0.20.3+ build distributed
  // via cdn.sheetjs.com (npmjs only ships 0.18.5 which has unpatched
  // prototype-pollution + ReDoS advisories). Even with the patched build,
  // file sources here should remain trusted (local admin op) — SheetJS's
  // CVEs were exploitable only via hostile xlsx input.
  //
  // The ESM build doesn't auto-link node:fs, so we have to bind it
  // explicitly via set_fs before calling readFile.
  const XLSXMod = await import("xlsx");
  const XLSX = (XLSXMod as unknown as { default?: typeof XLSXMod }).default ?? XLSXMod;
  const fs = await import("node:fs");
  if (typeof (XLSX as unknown as { set_fs?: (m: unknown) => void }).set_fs === "function") {
    (XLSX as unknown as { set_fs: (m: unknown) => void }).set_fs(fs);
  }
  const wb = XLSX.readFile(filePath, { cellDates: true });
  if (!wb.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(", ")}`);
  }
  const ws = wb.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: true,
    blankrows: false,
  });

  const rows: RawRow[] = [];
  for (const r of jsonRows) {
    const record: RawRow = {};
    let hasData = false;
    for (const key of Object.keys(r)) {
      const trimmedKey = key.trim();
      if (!trimmedKey) continue;
      const value = r[key];
      if (value == null || value === "") {
        record[trimmedKey] = null;
        continue;
      }
      hasData = true;
      if (value instanceof Date || typeof value === "number") {
        record[trimmedKey] = value;
      } else {
        record[trimmedKey] = String(value).trim();
      }
    }
    if (hasData) rows.push(record);
  }
  return rows;
}

interface ValidatedRow {
  index: number;
  payload: RowPayload;
  endAt: Date;
  endAtBumped: boolean;
  resolvedPersonId: string | null;
  secondaryPersonName: string | null;
  messages: Array<{ severity: "error" | "warning" | "info"; field?: string; message: string }>;
  hasError: boolean;
}

async function main(): Promise<void> {
  const filePath = resolveFile();
  console.log(`\n[restore:world-markets]`);
  console.log(`  file              ${filePath}`);
  console.log(`  sheet             ${SHEET_NAME}`);
  console.log(`  mode              ${DRY_RUN ? "DRY RUN (no DB writes)" : "LIVE WRITE"}`);
  console.log(`  bump-past-days    ${BUMP_PAST_DAYS} ${BUMP_PAST_DAYS === 0 ? "(skip past-dated rows)" : "(shift past dates to today + N)"}`);

  const rawRows = await readSheetRows(filePath, SHEET_NAME);
  console.log(`\nParsed ${rawRows.length} rows from spreadsheet.`);

  if (rawRows.length === 0) {
    console.error("[restore:world-markets] No rows in sheet. Aborting.");
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("\n[restore:world-markets] DATABASE_URL is not set.");
    console.error("  Make sure .env exists and points at your prod/dev database.");
    process.exit(1);
  }

  const { db } = await import("../server/db");
  const { predictionMarkets, marketEntries, trackedPeople, profiles } = await import("../shared/schema");
  const { eq, sql } = await import("drizzle-orm");
  const { seedAmmMarket, HOUSE_PROFILE_ID } = await import("../server/services/amm-house");

  const allPeople = await db
    .select({ id: trackedPeople.id, name: trackedPeople.name })
    .from(trackedPeople);

  // Accent-fold + collapse-whitespace for robust matching: the spreadsheet
  // uses "Kylian Mbappé" / "MrBeast" / "Beyoncé" while tracked_people stores
  // "Kylian Mbappe" / "Mr Beast" / "Beyonce". Without normalising, every one
  // of these would import without a person link.
  const normalizeName = (n: string): string =>
    n
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const normalizeKey = (n: string): string => normalizeName(n).replace(/\s+/g, "");

  const peopleByName = new Map<string, string>();
  for (const p of allPeople) {
    peopleByName.set(p.name.toLowerCase(), p.id);
    peopleByName.set(normalizeName(p.name), p.id);
    peopleByName.set(normalizeKey(p.name), p.id);
  }

  const lookupPerson = (raw: string): string | null =>
    peopleByName.get(raw.toLowerCase()) ??
    peopleByName.get(normalizeName(raw)) ??
    peopleByName.get(normalizeKey(raw)) ??
    null;

  const existingSlugRows = await db
    .select({ slug: predictionMarkets.slug })
    .from(predictionMarkets);
  const existingSlugs = new Set(existingSlugRows.map((m) => m.slug));

  const now = new Date();
  const bumpTarget = new Date(now.getTime() + BUMP_PAST_DAYS * 24 * 60 * 60 * 1000);

  const validated: ValidatedRow[] = [];
  const seenSlugs = new Set<string>();

  for (let i = 0; i < rawRows.length; i++) {
    const payload = rowToPayload(rawRows[i]);
    const msgs: ValidatedRow["messages"] = [];
    let hasError = false;

    if (!payload.title) {
      msgs.push({ severity: "error", field: "title", message: "Title is required" });
      hasError = true;
    }
    if (!payload.slug) {
      msgs.push({ severity: "error", field: "slug", message: "Slug is required" });
      hasError = true;
    } else if (!SLUG_REGEX.test(payload.slug)) {
      msgs.push({ severity: "error", field: "slug", message: "Slug must be URL-safe (lowercase, numbers, dashes)" });
      hasError = true;
    } else if (existingSlugs.has(payload.slug) || seenSlugs.has(payload.slug)) {
      msgs.push({ severity: "error", field: "slug", message: `Duplicate slug: ${payload.slug}` });
      hasError = true;
    }

    if (!payload.type || !VALID_TYPES.includes(payload.type)) {
      msgs.push({ severity: "error", field: "type", message: `Invalid type "${payload.type}". Must be binary, multi, or updown` });
      hasError = true;
    }

    let endAt: Date | null = null;
    let endAtBumped = false;
    if (!payload.resolutionDate) {
      msgs.push({ severity: "error", field: "resolutionDate", message: "Resolution date is required" });
      hasError = true;
    } else {
      const d = new Date(payload.resolutionDate);
      if (isNaN(d.getTime())) {
        msgs.push({ severity: "error", field: "resolutionDate", message: "Invalid resolution date" });
        hasError = true;
      } else if (d <= now) {
        if (BUMP_PAST_DAYS === 0) {
          msgs.push({ severity: "error", field: "resolutionDate", message: `Resolution date is in the past (${d.toISOString().slice(0, 10)}); --bump-past-days=0 skips it` });
          hasError = true;
        } else {
          endAt = bumpTarget;
          endAtBumped = true;
          msgs.push({
            severity: "warning",
            field: "resolutionDate",
            message: `Original ${d.toISOString().slice(0, 10)} is past; bumped to ${bumpTarget.toISOString().slice(0, 10)} (+${BUMP_PAST_DAYS}d)`,
          });
        }
      } else {
        endAt = d;
      }
    }

    if (payload.category && !VALID_CATEGORIES_LOWER.has(payload.category.toLowerCase())) {
      msgs.push({ severity: "warning", field: "category", message: `Category "${payload.category}" not in standard list; will be used as-is` });
    }

    if (payload.entries.length === 0) {
      msgs.push({ severity: "error", field: "entries", message: "At least one entry is required" });
      hasError = true;
    } else if (payload.type === "binary" && payload.entries.length !== 2) {
      msgs.push({ severity: "error", field: "entries", message: "Binary markets must have exactly 2 entries" });
      hasError = true;
    } else if (payload.type === "multi" && (payload.entries.length < 3 || payload.entries.length > 20)) {
      msgs.push({ severity: "error", field: "entries", message: "Multi markets must have 3-20 entries" });
      hasError = true;
    } else if (payload.type === "updown" && payload.entries.length !== 2) {
      msgs.push({ severity: "error", field: "entries", message: "Up/Down markets must have exactly 2 entries" });
      hasError = true;
    }

    if (payload.type === "updown") {
      if (!payload.underlying) {
        msgs.push({ severity: "error", field: "underlying", message: "Up/Down markets require underlying asset" });
        hasError = true;
      }
      if (payload.strike == null) {
        msgs.push({ severity: "error", field: "strike", message: "Up/Down markets require strike value" });
        hasError = true;
      }
    }

    let resolvedPersonId: string | null = null;
    let secondaryPersonName: string | null = null;
    if (payload.linkedPerson) {
      if (payload.linkedPerson.includes("/")) {
        const parts = payload.linkedPerson.split("/").map((s) => s.trim());
        const primaryName = parts[0];
        secondaryPersonName = parts.slice(1).join(", ");
        resolvedPersonId = lookupPerson(primaryName);
        if (!resolvedPersonId) {
          msgs.push({ severity: "warning", field: "linkedPerson", message: `Primary person "${primaryName}" not found in tracked people` });
        }
        msgs.push({ severity: "info", field: "linkedPerson", message: `Secondary person "${secondaryPersonName}" stored in metadata` });
      } else {
        resolvedPersonId = lookupPerson(payload.linkedPerson);
        if (!resolvedPersonId) {
          msgs.push({ severity: "warning", field: "linkedPerson", message: `Person "${payload.linkedPerson}" not found in tracked people` });
        }
      }
    }

    if (!hasError && endAt) seenSlugs.add(payload.slug);

    validated.push({
      index: i,
      payload,
      endAt: endAt ?? new Date(0),
      endAtBumped,
      resolvedPersonId,
      secondaryPersonName,
      messages: msgs,
      hasError,
    });
  }

  const errCount = validated.filter((v) => v.hasError).length;
  const okCount = validated.length - errCount;

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  Pre-flight validation`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`  total                 ${validated.length}`);
  console.log(`  will create           ${okCount}`);
  console.log(`  will fail validation  ${errCount}`);
  console.log(`  past-dates bumped     ${validated.filter((v) => v.endAtBumped).length}`);
  console.log(`──────────────────────────────────────────────`);

  for (const v of validated) {
    const icon = v.hasError ? "x" : v.endAtBumped ? "~" : "+";
    console.log(`${icon} [${v.index + 1}] ${v.payload.title || "(missing)"} (${v.payload.slug || "?"}) -> ${v.payload.type}`);
    for (const m of v.messages) {
      const prefix = m.severity === "error" ? "    ERROR" : m.severity === "warning" ? "    WARN " : "    INFO ";
      console.log(`${prefix}: ${m.field ? `[${m.field}] ` : ""}${m.message}`);
    }
  }

  // ── House-wallet pre-flight ───────────────────────────────────────
  // seedAmmMarket fails loudly if the house has insufficient credits,
  // but it does so mid-loop after some rows have already been inserted.
  // Cheaper to fail fast with a clear message that points at the
  // restore-house-wallet.ts companion script.
  const ESTIMATED_SEED_PER_MARKET = 5_000;
  const expectedSpend = okCount * ESTIMATED_SEED_PER_MARKET;
  const [houseRow] = await db
    .select({ predictCredits: profiles.predictCredits, isHouse: profiles.isHouse })
    .from(profiles)
    .where(eq(profiles.id, HOUSE_PROFILE_ID))
    .limit(1);
  if (!houseRow) {
    console.error(`\n[restore:world-markets] House profile ${HOUSE_PROFILE_ID} not found. Did migration 0052 run?`);
    process.exit(1);
  }
  console.log(`\nHouse wallet pre-flight:`);
  console.log(`  current balance       ${houseRow.predictCredits.toLocaleString()}`);
  console.log(`  rough seed estimate   ${expectedSpend.toLocaleString()} (${okCount} x ~${ESTIMATED_SEED_PER_MARKET})`);
  if (houseRow.predictCredits < expectedSpend) {
    console.error(
      `\n[restore:world-markets] House wallet has insufficient credits for the estimated seed cost.\n` +
      `  Run "npx tsx ops/restore-house-wallet.ts" first to top it up, then re-run this script.\n`,
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log(`\n[restore:world-markets] DRY RUN complete. Re-run without --dry-run to write.\n`);
    process.exit(0);
  }

  if (okCount === 0) {
    console.error(`\n[restore:world-markets] Nothing to write (all rows failed validation). Aborting.\n`);
    process.exit(1);
  }

  // ── Live insert phase ────────────────────────────────────────────
  console.log(`\n[restore:world-markets] Writing ${okCount} markets...`);

  let createdCount = 0;

  for (const v of validated) {
    if (v.hasError) continue;
    const { payload } = v;

    const metadata: Record<string, unknown> = {};
    if (payload.sourceNote) metadata.source = payload.sourceNote;
    if (v.secondaryPersonName) metadata.secondaryPerson = v.secondaryPersonName;
    if (payload.fitScore != null) metadata.fitScore = payload.fitScore;
    if (payload.settlementDifficulty) metadata.settlementDifficulty = payload.settlementDifficulty;
    if (payload.timeHorizon) metadata.timeHorizon = payload.timeHorizon;
    if (payload.launchWave) metadata.launchWave = payload.launchWave;
    // Tag every row imported via this recovery script (not just the
    // bumped-date ones) so future audits can identify "post-wipe
    // restorations" cleanly.
    metadata.restoredFromSunsetWipe = {
      bumpedPastDate: v.endAtBumped,
      on: now.toISOString(),
    };

    try {
      // Allocate next CMS display order inside the loop so concurrent rows don't collide.
      const [cmsRow] = await db
        .select({ max: sql<number>`COALESCE(MAX(cms_display_order), 0)` })
        .from(predictionMarkets)
        .where(eq(predictionMarkets.marketType, "community"));
      const nextCmsOrder = (cmsRow?.max ?? 0) + 1;

      const inserted = await db.transaction(async (tx) => {
        const [createdRow] = await tx
          .insert(predictionMarkets)
          .values({
            marketType: "community",
            engine: "amm",
            title: payload.title,
            slug: payload.slug,
            openMarketType: payload.type,
            teaser: payload.teaser,
            category: payload.category,
            personId: v.resolvedPersonId,
            endAt: v.endAt,
            closeAt: v.endAt,
            startAt: new Date(),
            resolutionCriteria: payload.resolutionCriteria ? [payload.resolutionCriteria] : null,
            resolveMethod: "admin_manual",
            status: "OPEN",
            visibility: "draft",
            isLive: false,
            featured: false,
            timezone: "UTC",
            underlying: payload.underlying ?? null,
            metric: payload.metric ?? null,
            strike: payload.strike != null ? String(payload.strike) : null,
            unit: payload.type === "updown" ? payload.unit ?? "$" : null,
            metadata: Object.keys(metadata).length > 0 ? metadata : null,
            createdBy: null,
            cmsDisplayOrder: nextCmsOrder,
          })
          .returning();

        const insertedEntries = await tx
          .insert(marketEntries)
          .values(
            payload.entries.map((e, idx) => ({
              marketId: createdRow.id,
              entryType: "custom" as const,
              label: e.label,
              description: null,
              displayOrder: idx,
            })),
          )
          .returning({ id: marketEntries.id, displayOrder: marketEntries.displayOrder });

        const entryIdsInOrder = insertedEntries
          .slice()
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map((e) => e.id);

        await seedAmmMarket(
          { marketId: createdRow.id, marketType: "community", entryIdsInOrder },
          tx,
        );

        return createdRow;
      });

      createdCount += 1;
      console.log(`  + ${inserted.slug}  ${inserted.id}`);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        console.error(`  ! Slug conflict on ${payload.slug}; skipping`);
      } else {
        console.error(`  ! Failed to insert ${payload.slug}:`, err);
        process.exitCode = 1;
      }
    }
  }

  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  Done. Created ${createdCount} community markets as AMM drafts.`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open Admin > Predictions > World Markets`);
  console.log(`  2. Filter by Visibility = Draft to review the ${createdCount} restored markets`);
  console.log(`  3. Add cover images via the Edit (pencil) button`);
  console.log(`  4. Select wave-1 rows and click "Publish [N]" to make them live`);
  console.log(``);

  process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
  console.error("\n[restore:world-markets] FAILED:", err);
  process.exit(1);
});
