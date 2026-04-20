/**
 * Apply verdicts from an audit-social-handles CSV back to tracked_people.
 *
 * Input CSV is the one produced by audit-social-handles.ts, with the
 * `verdict` column filled in per row:
 *
 *   verdict = "" | "keep"      -> no-op
 *   verdict = "remove"         -> set that platform's column to NULL
 *   verdict = "replace"        -> set that column to `replacement_handle`
 *                                 (must be non-empty and normalise cleanly)
 *
 * Safety behaviour:
 *   - Dry-run by default. Pass --apply to actually write.
 *   - Before touching a row, we confirm the CSV's `handle` still matches the
 *     DB's current value. If the DB has drifted (someone edited via admin UI,
 *     or a re-backfill ran), we skip the row with a warning so we never
 *     silently overwrite curated data. Use --force to override this guard.
 *   - Replacement values go through shared/handleNormalise.ts so the same
 *     validation the admin API uses is applied (UC-prefix for YouTube, 22
 *     base62 chars for Spotify, @-stripping for usernames).
 *
 * Usage:
 *   npx tsx --env-file=.env server/scripts/apply-handle-verdicts.ts
 *   npx tsx --env-file=.env server/scripts/apply-handle-verdicts.ts --apply
 *   npx tsx --env-file=.env server/scripts/apply-handle-verdicts.ts --csv=path/to/verdicts.csv --apply
 */

import { promises as fs } from "fs";
import path from "path";
import { db, pool } from "../db";
import { trackedPeople } from "@shared/schema";
import { eq } from "drizzle-orm";
import { normaliseSocialHandles, type SocialHandleKey } from "@shared/handleNormalise";

// ---------- CLI ----------

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const force = args.includes("--force");
const csvArg = args.find(a => a.startsWith("--csv="));
const csvPath = csvArg
  ? path.resolve(process.cwd(), csvArg.slice("--csv=".length))
  : path.resolve(process.cwd(), "tmp", "social-audit", "suspicious-handles.csv");

// ---------- Platform mapping ----------

const PLATFORM_TO_KEY: Record<string, SocialHandleKey> = {
  X: "xHandle",
  Instagram: "instagramHandle",
  TikTok: "tiktokHandle",
  YouTube: "youtubeId",
  Spotify: "spotifyId",
};

// ---------- Minimal RFC-4180 CSV parser ----------

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop trailing blank rows.
  return rows.filter(r => r.some(cell => cell.length > 0));
}

type VerdictRow = {
  person: string;
  platform: string;
  handle: string;
  verdict: string;
  replacement_handle: string;
  notes: string;
  lineNo: number;
};

function readVerdictCsv(text: string): VerdictRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map(h => h.trim());
  const required = ["person", "platform", "handle", "verdict"];
  for (const r of required) {
    if (!header.includes(r)) {
      throw new Error(`CSV is missing required column "${r}". Found: ${header.join(", ")}`);
    }
  }
  const idx = (col: string) => header.indexOf(col);
  const out: VerdictRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    out.push({
      person: (cells[idx("person")] ?? "").trim(),
      platform: (cells[idx("platform")] ?? "").trim(),
      handle: (cells[idx("handle")] ?? "").trim(),
      verdict: (cells[idx("verdict")] ?? "").trim().toLowerCase(),
      replacement_handle: (cells[idx("replacement_handle")] ?? "").trim(),
      notes: (cells[idx("notes")] ?? "").trim(),
      lineNo: r + 1,
    });
  }
  return out;
}

// ---------- Plan ----------

type Change =
  | { kind: "remove"; personId: string; personName: string; column: SocialHandleKey; from: string }
  | { kind: "replace"; personId: string; personName: string; column: SocialHandleKey; from: string; to: string };

type SkipReason =
  | "no_verdict"
  | "keep"
  | "unknown_platform"
  | "person_not_found"
  | "handle_mismatch"
  | "replace_missing_target"
  | "replace_invalid_target"
  | "replace_same_as_current"
  | "already_cleared"
  | "unknown_verdict";

type Skip = {
  row: VerdictRow;
  reason: SkipReason;
  detail?: string;
};

async function buildPlan(rows: VerdictRow[]): Promise<{ changes: Change[]; skips: Skip[] }> {
  const changes: Change[] = [];
  const skips: Skip[] = [];

  const people = await db.select().from(trackedPeople);
  const byNameLower = new Map<string, typeof people[number]>();
  for (const p of people) byNameLower.set(p.name.toLowerCase(), p);

  for (const row of rows) {
    if (row.verdict === "" || row.verdict === "keep") {
      skips.push({ row, reason: row.verdict === "keep" ? "keep" : "no_verdict" });
      continue;
    }

    const column = PLATFORM_TO_KEY[row.platform];
    if (!column) {
      skips.push({ row, reason: "unknown_platform", detail: `"${row.platform}" is not one of ${Object.keys(PLATFORM_TO_KEY).join(", ")}` });
      continue;
    }

    const person = byNameLower.get(row.person.toLowerCase());
    if (!person) {
      skips.push({ row, reason: "person_not_found" });
      continue;
    }

    const current = person[column] ?? null;

    if (row.verdict === "remove") {
      if (current === null) {
        skips.push({ row, reason: "already_cleared" });
        continue;
      }
      if (!force && current !== row.handle) {
        skips.push({
          row,
          reason: "handle_mismatch",
          detail: `DB has "${current}", CSV has "${row.handle}". Re-run audit or pass --force.`,
        });
        continue;
      }
      changes.push({
        kind: "remove",
        personId: person.id,
        personName: person.name,
        column,
        from: current,
      });
      continue;
    }

    if (row.verdict === "replace") {
      if (!row.replacement_handle) {
        skips.push({ row, reason: "replace_missing_target" });
        continue;
      }
      if (!force && current !== null && current !== row.handle) {
        skips.push({
          row,
          reason: "handle_mismatch",
          detail: `DB has "${current}", CSV has "${row.handle}".`,
        });
        continue;
      }

      const { values, errors } = normaliseSocialHandles({ [column]: row.replacement_handle });
      if (errors[column]) {
        skips.push({ row, reason: "replace_invalid_target", detail: errors[column] });
        continue;
      }
      const target = values[column];
      if (!target) {
        skips.push({ row, reason: "replace_invalid_target", detail: "normaliser produced an empty value" });
        continue;
      }
      if (target === current) {
        skips.push({ row, reason: "replace_same_as_current" });
        continue;
      }

      changes.push({
        kind: "replace",
        personId: person.id,
        personName: person.name,
        column,
        from: current ?? "(null)",
        to: target,
      });
      continue;
    }

    skips.push({ row, reason: "unknown_verdict", detail: `"${row.verdict}" is not one of keep, remove, replace` });
  }

  return { changes, skips };
}

// ---------- Main ----------

async function main() {
  console.log("=".repeat(70));
  console.log("Apply handle verdicts");
  console.log(`CSV:  ${csvPath}`);
  console.log(`Mode: ${apply ? "APPLY (writes to DB)" : "DRY-RUN (no writes)"}`);
  if (force) console.log("Flag: --force (handle-mismatch guard disabled)");
  console.log("=".repeat(70));

  let csvText: string;
  try {
    csvText = await fs.readFile(csvPath, "utf8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Could not read CSV at ${csvPath}: ${msg}`);
    process.exitCode = 1;
    return;
  }

  const rows = readVerdictCsv(csvText);
  console.log(`Rows read: ${rows.length}`);

  const { changes, skips } = await buildPlan(rows);

  console.log(`\nPlan: ${changes.length} change(s), ${skips.length} skip(s)`);

  if (changes.length > 0) {
    console.log(`\nChanges:`);
    for (const c of changes) {
      if (c.kind === "remove") {
        console.log(`  - REMOVE  ${c.personName.padEnd(28)} ${c.column.padEnd(17)} was="${c.from}" -> null`);
      } else {
        console.log(`  - REPLACE ${c.personName.padEnd(28)} ${c.column.padEnd(17)} "${c.from}" -> "${c.to}"`);
      }
    }
  }

  // Group skips by reason so noisy categories (no_verdict, keep) collapse.
  const quiet: SkipReason[] = ["no_verdict", "keep"];
  const noisy = skips.filter(s => !quiet.includes(s.reason));
  const quietCounts = skips
    .filter(s => quiet.includes(s.reason))
    .reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {});

  if (Object.keys(quietCounts).length > 0) {
    console.log(`\nSkipped (no action intended):`);
    for (const [reason, count] of Object.entries(quietCounts)) {
      console.log(`  ${reason.padEnd(18)} ${count}`);
    }
  }

  if (noisy.length > 0) {
    console.log(`\nSkipped (needs your attention):`);
    for (const s of noisy) {
      const loc = `line ${s.row.lineNo}`;
      const base = `  [${s.reason}] ${loc}  ${s.row.person} / ${s.row.platform} / ${s.row.handle}`;
      console.log(s.detail ? `${base} -- ${s.detail}` : base);
    }
  }

  if (!apply) {
    console.log(`\nDry-run only. Re-run with --apply to commit these ${changes.length} change(s).`);
    return;
  }

  if (changes.length === 0) {
    console.log(`\nNothing to apply.`);
    return;
  }

  // Group by personId so each person gets a single UPDATE.
  const byPerson = new Map<string, { name: string; patch: Partial<Record<SocialHandleKey, string | null>> }>();
  for (const c of changes) {
    const entry = byPerson.get(c.personId) ?? { name: c.personName, patch: {} };
    entry.patch[c.column] = c.kind === "remove" ? null : c.to;
    byPerson.set(c.personId, entry);
  }

  let written = 0;
  for (const [personId, { name, patch }] of byPerson) {
    await db.update(trackedPeople).set(patch).where(eq(trackedPeople.id, personId));
    written++;
    console.log(`  ✓ ${name}: ${Object.keys(patch).join(", ")}`);
  }

  console.log(`\nDone. Updated ${written} person record(s), applying ${changes.length} column change(s).`);
}

main()
  .catch(err => {
    console.error("Apply failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
