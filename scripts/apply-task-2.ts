import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";

async function runSqlFile(path: string, label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`Reading ${path}`);
  const content = readFileSync(path, "utf8");
  // Split on the Drizzle breakpoint marker and filter empty statements
  const statements = content
    .split("--> statement-breakpoint")
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.split("\n").every(line => line.trim().startsWith("--") || line.trim() === ""));

  console.log(`Found ${statements.length} statement(s).`);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.split("\n")[0].slice(0, 100);
    console.log(`  [${i + 1}/${statements.length}] ${preview}${stmt.split("\n")[0].length > 100 ? "..." : ""}`);
    await db.execute(sql.raw(stmt));
  }
  console.log(`✓ ${label} complete`);
}

async function main() {
  const migrationsDir = join(process.cwd(), "migrations");
  await runSqlFile(join(migrationsDir, "0010_add_voxmax_legend_rank.sql"), "Migration 0010 — VoxMax Legend tier");
  await runSqlFile(join(migrationsDir, "0011_xp_ledger_user_action_date_idx.sql"), "Migration 0011 — xp_ledger composite index");
  console.log("\n=== All Task 2 DDL applied ===");
  process.exit(0);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
