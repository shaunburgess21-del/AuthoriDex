/**
 * Post-import checks: special slugs, samples, image HEAD, vote note.
 * npx tsx --env-file=.env server/scripts/validate-induction-post-import.ts
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../db";

const SAMPLE_NEW = ["Angela Rayner", "Aravind Srinivas", "Central Cee"];
const SAMPLE_OVERLAP = ["Sabrina Carpenter", "Rosé"];

function inductionPrimaryUrl(base: string, slug: string): string {
  const seg = encodeURIComponent(slug);
  return `${base.replace(/\/$/, "")}/celebrity-large/${seg}/1.webp`;
}

async function main() {
  const special = await db.execute(sql.raw(`
    SELECT display_name, image_slug
    FROM induction_candidates
    WHERE image_slug !~ '^[a-z0-9-]+$'
    ORDER BY display_name
    LIMIT 30
  `));
  console.log("--- slugs with chars outside [a-z0-9-] ---");
  console.log(JSON.stringify((special as any).rows, null, 2));

  for (const [label, names] of [
    ["sample new CSV names", SAMPLE_NEW],
    ["sample overlap names", SAMPLE_OVERLAP],
  ] as const) {
    const list = names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(", ");
    const rows = await db.execute(sql.raw(`
      SELECT display_name, image_slug, x_handle, seed_votes, is_active, induction_status
      FROM induction_candidates WHERE display_name IN (${list})
    `));
    console.log("\n--- " + label + " ---");
    console.log(JSON.stringify((rows as any).rows, null, 2));
  }

  const urlEnv = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (urlEnv) {
    const base = urlEnv.replace(/\/$/, "") + "/storage/v1/object/public";
    const slugs = await db.execute(sql.raw(`
      SELECT display_name, image_slug FROM induction_candidates
      WHERE display_name IN ('Pedro Sánchez', 'Rosé')
    `));
    console.log("\n--- HEAD celebrity-large/.../1.webp ---");
    for (const row of (slugs as any).rows as { display_name: string; image_slug: string }[]) {
      const u = inductionPrimaryUrl(base, row.image_slug);
      try {
        const res = await fetch(u, { method: "HEAD" });
        console.log(row.display_name, row.image_slug, res.status, u.slice(0, 72) + "…");
      } catch (e: any) {
        console.log(row.display_name, e.message);
      }
    }
  } else {
    console.log("\n(Set SUPABASE_URL or VITE_SUPABASE_URL to test image HEAD)");
  }

  console.log(
    "\nVoting: POST /api/vote/induction/:id/vote requires auth — verify in browser while signed in.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
