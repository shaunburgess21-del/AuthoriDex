import fs from "fs";
import path from "path";
import pRetry from "p-retry";
import { db, pool } from "../db";
import { inductionCandidates } from "@shared/schema";
import { eq } from "drizzle-orm";
import { ensureInductionCandidateColumns } from "./ensure-induction-candidate-columns";

function deriveIsActive(status: string): boolean {
  const s = (status || "Queue").trim().toLowerCase();
  if (["inducted", "rejected", "inactive", "archived"].includes(s)) return false;
  return true;
}

function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normalizeXHandle(raw: string): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return t.replace(/^@+/, "");
}

async function main() {
  const csvPath =
    process.argv[2] ||
    path.join(process.cwd(), "server/data/voxdex_induction_additions.csv");
  if (!fs.existsSync(csvPath)) {
    console.error("CSV not found:", csvPath);
    process.exit(1);
  }
  let text = fs.readFileSync(csvPath, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    console.error("CSV has no data rows");
    process.exit(1);
  }
  const header = parseCsvRow(lines[0]).map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.findIndex((h) => h === name);
    if (i < 0) throw new Error(`Missing column: ${name}`);
    return i;
  };
  const iName = idx("Name");
  const iCat = idx("Category");
  const iWiki = idx("Wiki_Slug");
  const iX = idx("X_Handle");
  const iSeed = idx("Seed Votes");
  const iStatus = idx("Induction Status");
  const iImg = idx("Image Slug");

  await ensureInductionCandidateColumns();

  await pRetry(
    async () => {
      let inserted = 0;
      let updated = 0;

      for (let r = 1; r < lines.length; r++) {
        const cols = parseCsvRow(lines[r]);
        if (cols.length < header.length) continue;
        const displayName = cols[iName]?.trim();
        if (!displayName) continue;
        const category = cols[iCat]?.trim();
        if (!category) continue;
        const wikiSlug = cols[iWiki]?.trim() || null;
        const xHandle = normalizeXHandle(cols[iX] || "");
        const seedVotes = Math.max(0, parseInt(String(cols[iSeed] ?? "0"), 10) || 0);
        const inductionStatus = (cols[iStatus]?.trim() || "Queue") || "Queue";
        const imageSlug = cols[iImg]?.trim();
        if (!imageSlug) {
          console.warn("Skipping row without Image Slug:", displayName);
          continue;
        }
        const isActive = deriveIsActive(inductionStatus);

        const existing = await db
          .select({ id: inductionCandidates.id })
          .from(inductionCandidates)
          .where(eq(inductionCandidates.displayName, displayName))
          .limit(1);

        if (existing[0]) {
          await db
            .update(inductionCandidates)
            .set({
              category,
              imageSlug,
              wikiSlug,
              seedVotes,
              xHandle,
              inductionStatus,
              isActive,
            })
            .where(eq(inductionCandidates.id, existing[0].id));
          updated++;
        } else {
          await db.insert(inductionCandidates).values({
            displayName,
            category,
            imageSlug,
            wikiSlug,
            seedVotes,
            xHandle,
            inductionStatus,
            isActive,
          });
          inserted++;
        }
      }

      console.log(`Induction CSV import done: ${inserted} inserted, ${updated} updated`);
    },
    {
      retries: 6,
      minTimeout: 3000,
      factor: 2,
      onFailedAttempt: ({ error, attemptNumber }) => {
        console.warn(
          `[import:induction] attempt ${attemptNumber} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    },
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());