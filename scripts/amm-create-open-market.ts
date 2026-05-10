/**
 * Phase 10 helper: create a fresh AMM market and LEAVE IT OPEN.
 *
 * Unlike `amm-smoke.ts` (which runs the full Phase 3 buy/sell/resolve
 * lifecycle and ends with a resolved market), this helper just:
 *   1. Signs in alice (admin) via Supabase Auth.
 *   2. POST /api/admin/amm/smoke-create-market → fresh OPEN AMM market.
 *   3. Prints the marketId + entry IDs for the next step (queueing an
 *      agent action).
 *
 * Reads:
 *   - .env       (Supabase URL + anon key)
 *   - .env.smoke (admin credentials, gitignored)
 *
 * Run with:
 *   npm run amm:create-open    (or:  npx tsx scripts/amm-create-open-market.ts)
 *
 * Env knobs:
 *   - SMOKE_NUM_OUTCOMES   (default: 2 — exercises agent "no" translation)
 *   - SMOKE_TARGET_MAX_LOSS (default: 5000)
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), ".env.smoke"));

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[amm-create-open] Missing env var: ${name}.`);
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const BASE_URL = requireEnv("SMOKE_BASE_URL").replace(/\/$/, "");
const ADMIN_EMAIL = requireEnv("SMOKE_ALICE_EMAIL");
const ADMIN_PASSWORD = requireEnv("SMOKE_ALICE_PASSWORD");
const NUM_OUTCOMES = Number(process.env.SMOKE_NUM_OUTCOMES ?? 2);
const TARGET_MAX_LOSS = Number(process.env.SMOKE_TARGET_MAX_LOSS ?? 5000);

async function main(): Promise<void> {
  console.log("\nAMM create-open helper (Phase 10)");
  console.log(`  baseUrl    ${BASE_URL}`);
  console.log(`  outcomes   ${NUM_OUTCOMES}`);
  console.log(`  targetMaxLoss ${TARGET_MAX_LOSS}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`Sign-in failed for ${ADMIN_EMAIL}: ${error?.message ?? "no session"}`);
  }

  const res = await fetch(`${BASE_URL}/api/admin/amm/smoke-create-market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({
      numOutcomes: NUM_OUTCOMES,
      targetMaxLoss: TARGET_MAX_LOSS,
      title: `[Phase 10] Agent smoke market (${NUM_OUTCOMES}-outcome)`,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`\n[FAIL] ${res.status}: ${text}`);
    process.exit(1);
  }

  const json = JSON.parse(text);
  console.log(`\n[OK] Market created and left OPEN:\n`);
  console.log(`  marketId           ${json.marketId}`);
  console.log(`  slug               ${json.slug}`);
  console.log(`  numOutcomes        ${json.numOutcomes}`);
  console.log(`  liquidityB         ${json.liquidityB?.toFixed?.(2) ?? json.liquidityB}`);
  console.log(`  houseSeed          ${json.houseSeedAmount}`);
  console.log(`  houseBalanceAfter  ${json.houseBalanceAfter}`);
  console.log(`  entries:`);
  for (const e of json.entries ?? []) {
    console.log(`    [${e.displayOrder}] ${e.label}  ${e.id}`);
  }
  console.log(
    `\nNext step: tell the assistant the marketId above so it can queue an agent action against entry A.\n`,
  );
}

main().catch((err) => {
  console.error("\n[amm-create-open] failed:", err);
  process.exit(1);
});
