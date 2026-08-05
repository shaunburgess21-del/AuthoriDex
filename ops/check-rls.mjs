import pg from "pg";
import { readFileSync } from "fs";

// Load .env manually so we don't depend on --env-file quirks
const envText = readFileSync(".env", "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  const key = m[1].trim();
  let val = m[2].trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const { Client } = pg;
const c = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await c.connect();

const rls = await c.query(`
  SELECT c.relname AS table_name,
         c.relrowsecurity AS rls_enabled,
         COALESCE((
           SELECT count(*)::int FROM pg_policy pol WHERE pol.polrelid = c.oid
         ), 0) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  ORDER BY c.relrowsecurity ASC, c.relname
`);

const disabled = rls.rows.filter((r) => !r.rls_enabled);
const enabledNoPolicy = rls.rows.filter(
  (r) => r.rls_enabled && r.policy_count === 0,
);
const enabledWithPolicy = rls.rows.filter(
  (r) => r.rls_enabled && r.policy_count > 0,
);

console.log("\n=== RLS DISABLED (CRITICAL advisor: rls_disabled_in_public) ===");
console.log(`Count: ${disabled.length}`);
for (const r of disabled) console.log(`  - ${r.table_name}`);

console.log("\n=== RLS ENABLED, NO POLICIES (deny-by-default for anon) ===");
console.log(`Count: ${enabledNoPolicy.length}`);

console.log("\n=== RLS ENABLED WITH POLICIES ===");
console.log(`Count: ${enabledWithPolicy.length}`);
for (const r of enabledWithPolicy) {
  console.log(`  - ${r.table_name} (${r.policy_count} policies)`);
}

const grants = await c.query(`
  SELECT table_name, grantee,
         string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated', 'public')
  GROUP BY table_name, grantee
  ORDER BY table_name, grantee
`);

const grantByTable = new Map();
for (const g of grants.rows) {
  if (!grantByTable.has(g.table_name)) grantByTable.set(g.table_name, []);
  grantByTable.get(g.table_name).push(`${g.grantee}: ${g.privileges}`);
}

console.log("\n=== EXPOSURE: RLS-DISABLED TABLES WITH anon/authenticated GRANTS ===");
let exposed = 0;
for (const r of disabled) {
  const g = grantByTable.get(r.table_name);
  if (g?.length) {
    exposed++;
    console.log(`  EXPOSED  ${r.table_name}`);
    for (const line of g) console.log(`           ${line}`);
  } else {
    console.log(`  (no anon grants) ${r.table_name}`);
  }
}
console.log(`\nExposed count: ${exposed} / ${disabled.length}`);

await c.end();
