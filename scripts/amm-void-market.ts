/**
 * Phase 10 helper: VOID an AMM market via the admin endpoint.
 *
 * Refunds every user their net credits in, returns the seed to the house,
 * and marks the market RESOLVED with void semantics.
 *
 * Reads:
 *   - .env       (Supabase URL + anon key)
 *   - .env.smoke (admin credentials, gitignored)
 *
 * Run with:
 *   npm run amm:void -- <marketId>
 *   or:  npx tsx scripts/amm-void-market.ts <marketId>
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
    console.error(`[amm-void] Missing env var: ${name}.`);
    process.exit(2);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_ANON_KEY = requireEnv("SUPABASE_ANON_KEY");
const BASE_URL = requireEnv("SMOKE_BASE_URL").replace(/\/$/, "");
const ADMIN_EMAIL = requireEnv("SMOKE_ALICE_EMAIL");
const ADMIN_PASSWORD = requireEnv("SMOKE_ALICE_PASSWORD");

const marketId = process.argv[2]?.trim();
if (!marketId) {
  console.error("Usage: npx tsx scripts/amm-void-market.ts <marketId>");
  process.exit(2);
}

async function main(): Promise<void> {
  console.log(`\nAMM void helper`);
  console.log(`  baseUrl   ${BASE_URL}`);
  console.log(`  marketId  ${marketId}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(`Sign-in failed for ${ADMIN_EMAIL}: ${error?.message ?? "no session"}`);
  }

  const res = await fetch(`${BASE_URL}/api/admin/markets/${marketId}/amm-resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ void: true }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`\n[FAIL] ${res.status}: ${text}`);
    process.exit(1);
  }

  const json = JSON.parse(text);
  console.log(`\n[OK] Market voided:\n`);
  console.log(`  outcome              ${json.outcome}`);
  console.log(`  payoutLiability      ${json.payoutLiability}`);
  console.log(`  creditedToHouse      ${json.creditedToHouse}`);
  console.log(`  settledUserCount     ${json.settledUserCount}`);
  console.log(`  idempotentSkip       ${json.idempotentSkip ?? false}`);
  console.log("");
}

main().catch((err) => {
  console.error("\n[amm-void] failed:", err);
  process.exit(1);
});
