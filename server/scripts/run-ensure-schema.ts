/**
 * Runs idempotent SQL from server/sql/ensure/ in lexical order.
 *   npx tsx --env-file=.env server/scripts/run-ensure-schema.ts
 *   npx tsx --env-file=.env server/scripts/run-ensure-schema.ts --only 001
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENSURE_DIR = path.join(__dirname, "../sql/ensure");

function parseOnlyArg(): string | null {
  const i = process.argv.findIndex((a) => a === "--only" || a.startsWith("--only="));
  if (i < 0) return null;
  if (process.argv[i].includes("=")) return process.argv[i].split("=")[1]?.trim() || null;
  return process.argv[i + 1]?.trim() || null;
}

export async function runEnsureSqlFiles(options?: { onlyPrefix?: string | null }): Promise<void> {
  const only =
    options && Object.prototype.hasOwnProperty.call(options, "onlyPrefix")
      ? options.onlyPrefix
      : parseOnlyArg();

  if (!fs.existsSync(ENSURE_DIR)) {
    console.warn("[db:ensure] No directory", ENSURE_DIR);
    return;
  }

  const files = fs
    .readdirSync(ENSURE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const selected =
    only && only.length > 0
      ? files.filter((f) => f.startsWith(only) || f.includes(only))
      : files;

  if (only && only.length > 0 && selected.length === 0) {
    throw new Error(`[db:ensure] No .sql files match --only ${JSON.stringify(only)}`);
  }

  const client = await pool.connect();
  try {
    for (const file of selected) {
      const full = path.join(ENSURE_DIR, file);
      const sqlText = fs.readFileSync(full, "utf8").replace(/^\uFEFF/, "");
      console.log("[db:ensure] applying", file, "…");
      await client.query(sqlText);
      console.log("[db:ensure] done", file);
    }
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
  runEnsureSqlFiles()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => pool.end());
}