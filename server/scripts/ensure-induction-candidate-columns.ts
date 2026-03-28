/**
 * Idempotent: adds induction_candidates columns from migration 0004.
 * Run: npx tsx --env-file=.env server/scripts/ensure-induction-candidate-columns.ts
 */
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db";

export async function ensureInductionCandidateColumns(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `ALTER TABLE induction_candidates ADD COLUMN IF NOT EXISTS x_handle text`,
    );
    await client.query(
      `ALTER TABLE induction_candidates ADD COLUMN IF NOT EXISTS induction_status text DEFAULT 'Queue' NOT NULL`,
    );
  } finally {
    client.release();
  }
}

function isRunAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    path.normalize(path.resolve(entry)) ===
    path.normalize(fileURLToPath(import.meta.url))
  );
}

if (isRunAsCli()) {
  ensureInductionCandidateColumns()
    .then(() => console.log("induction_candidates: x_handle + induction_status OK."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => pool.end());
}
