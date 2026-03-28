/**
 * Idempotent: applies server/sql/ensure/001_induction_candidate_columns.sql
 * Run: npx tsx --env-file=.env server/scripts/ensure-induction-candidate-columns.ts
 */
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db";
import { runEnsureSqlFiles } from "./run-ensure-schema";

export async function ensureInductionCandidateColumns(): Promise<void> {
  await runEnsureSqlFiles({ onlyPrefix: "001" });
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
