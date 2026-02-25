import { db, pool } from '../db';
import { matchups } from '../../shared/schema';
import { eq } from 'drizzle-orm';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const SKIP_VALIDATION = process.env.SKIP_VALIDATION === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL not set');
  process.exit(1);
}

const BASE = `${SUPABASE_URL}/storage/v1/object/public/matchups`;

function slugifyName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function resolveUrl(slug: string, name: string): Promise<string | null> {
  const base = slugifyName(name);
  const exts = ['.webp', '.png', '.jpg', '.jpeg'];
  for (const ext of exts) {
    const url = `${BASE}/${slug}/${base}${ext}`;
    if (SKIP_VALIDATION) return url;
    const ok = await checkUrl(url);
    if (ok) return url;
  }
  return null;
}

async function main() {
  console.log(`\n=== Matchup Image Repair (DRY_RUN=${DRY_RUN}, SKIP_VALIDATION=${SKIP_VALIDATION}) ===\n`);
  console.log(`Base URL: ${BASE}\n`);

  const allMatchups = await db.select({
    id: matchups.id,
    slug: matchups.slug,
    optionAText: matchups.optionAText,
    optionBText: matchups.optionBText,
    optionAImage: matchups.optionAImage,
    optionBImage: matchups.optionBImage,
  }).from(matchups);

  const withSlug = allMatchups.filter(m => m.slug);
  const noSlug = allMatchups.filter(m => !m.slug);
  console.log(`Matchups: ${allMatchups.length} total, ${withSlug.length} with slug, ${noSlug.length} without slug\n`);

  let updated = 0;
  let skipped = 0;
  let validationFailed = 0;

  for (const m of withSlug) {
    const slug = m.slug!;
    const nameA = m.optionAText || '';
    const nameB = m.optionBText || '';

    if (!nameA || !nameB) {
      console.log(`  SKIP: ${slug} — missing option text`);
      skipped++;
      continue;
    }

    const fileA = slugifyName(nameA);
    const fileB = slugifyName(nameB);

    let urlA: string | null;
    let urlB: string | null;

    if (SKIP_VALIDATION) {
      urlA = `${BASE}/${slug}/${fileA}.webp`;
      urlB = `${BASE}/${slug}/${fileB}.webp`;
    } else {
      [urlA, urlB] = await Promise.all([
        resolveUrl(slug, nameA),
        resolveUrl(slug, nameB),
      ]);
    }

    if (!urlA && !urlB) {
      console.log(`  FAIL: ${slug} — no URLs resolved for "${nameA}" or "${nameB}"`);
      validationFailed++;
      continue;
    }

    const aFile = urlA ? urlA.split('/').pop() : 'NOT FOUND';
    const bFile = urlB ? urlB.split('/').pop() : 'NOT FOUND';
    const status = (!urlA || !urlB) ? 'PARTIAL' : 'OK';
    console.log(`  ${status}: ${slug}`);
    console.log(`        A "${nameA}" (${fileA}.*) → ${aFile}`);
    console.log(`        B "${nameB}" (${fileB}.*) → ${bFile}`);

    if (!DRY_RUN) {
      const updateData: any = {};
      if (urlA) updateData.optionAImage = urlA;
      if (urlB) updateData.optionBImage = urlB;
      if (Object.keys(updateData).length > 0) {
        await db.update(matchups).set(updateData).where(eq(matchups.id, m.id));
      }
    }

    updated++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (no slug / no text): ${skipped + noSlug.length}`);
  console.log(`  Validation failed (no files found): ${validationFailed}`);
  console.log(`  DRY_RUN: ${DRY_RUN}`);
  if (DRY_RUN) {
    console.log(`\n  To apply with validation: DRY_RUN=false npx tsx server/scripts/repair-matchup-images.ts`);
    console.log(`  To apply without validation: DRY_RUN=false SKIP_VALIDATION=true npx tsx server/scripts/repair-matchup-images.ts\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
