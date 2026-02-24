import { db, pool } from '../db';
import { matchups } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { supabaseServer } from '../supabase';

const DRY_RUN = process.env.DRY_RUN !== 'false';
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!SUPABASE_URL) {
  console.error('ERROR: SUPABASE_URL not set');
  process.exit(1);
}

const BUCKET = 'matchups';
const IMAGE_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg']);
const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(dot).toLowerCase() : '';
}

function stripExt(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.substring(0, dot) : filename;
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { method: 'HEAD' });
    return resp.ok;
  } catch {
    return false;
  }
}

interface MatchResult {
  fileA: string | null;
  fileB: string | null;
  method: 'name-match' | 'alphabetical' | 'partial' | 'none';
  warning?: string;
}

function matchFiles(files: string[], optionAText: string, optionBText: string): MatchResult {
  if (files.length === 0) {
    return { fileA: null, fileB: null, method: 'none' };
  }

  const normA = normalize(optionAText);
  const normB = normalize(optionBText);

  let fileA: string | null = null;
  let fileB: string | null = null;

  for (const f of files) {
    const normFile = normalize(stripExt(f));

    if (normFile === 'optiona' || normFile === 'option-a') { fileA = f; continue; }
    if (normFile === 'optionb' || normFile === 'option-b') { fileB = f; continue; }

    if (!fileA && normFile === normA) { fileA = f; continue; }
    if (!fileB && normFile === normB) { fileB = f; continue; }

    if (!fileA && (normFile.includes(normA) || normA.includes(normFile))) { fileA = f; continue; }
    if (!fileB && (normFile.includes(normB) || normB.includes(normFile))) { fileB = f; continue; }
  }

  if (fileA && fileB) {
    return { fileA, fileB, method: 'name-match' };
  }

  if (files.length === 2 && !fileA && !fileB) {
    const sorted = [...files].sort();
    return {
      fileA: sorted[0],
      fileB: sorted[1],
      method: 'alphabetical',
      warning: `No name match — assigned alphabetically: A="${sorted[0]}", B="${sorted[1]}"`,
    };
  }

  if (fileA || fileB) {
    const remaining = files.filter(f => f !== fileA && f !== fileB);
    if (remaining.length === 1) {
      if (!fileA) fileA = remaining[0];
      else if (!fileB) fileB = remaining[0];
      return { fileA, fileB, method: 'partial', warning: `One matched by name, other assigned by elimination` };
    }
  }

  if (files.length === 2) {
    const sorted = [...files].sort();
    return {
      fileA: sorted[0],
      fileB: sorted[1],
      method: 'alphabetical',
      warning: `Partial match ambiguous — fell back to alphabetical: A="${sorted[0]}", B="${sorted[1]}"`,
    };
  }

  return {
    fileA: fileA,
    fileB: fileB,
    method: 'none',
    warning: `${files.length} files found, could not determine A/B mapping`,
  };
}

async function main() {
  console.log(`\n=== Matchup Image Repair (DRY_RUN=${DRY_RUN}) ===\n`);

  const allMatchups = await db.select({
    id: matchups.id,
    slug: matchups.slug,
    optionAText: matchups.optionAText,
    optionBText: matchups.optionBText,
    optionAImage: matchups.optionAImage,
    optionBImage: matchups.optionBImage,
  }).from(matchups);

  console.log(`Found ${allMatchups.length} matchups in DB\n`);

  const withSlug = allMatchups.filter(m => m.slug);
  const noSlug = allMatchups.filter(m => !m.slug);
  console.log(`  With slug: ${withSlug.length}`);
  console.log(`  Without slug (skipping): ${noSlug.length}\n`);

  let updated = 0;
  let skipped = 0;
  let partial = 0;
  let ambiguous = 0;
  let validated = 0;
  let validationFailed = 0;

  for (const m of withSlug) {
    const slug = m.slug!;

    const { data: fileList, error } = await supabaseServer.storage.from(BUCKET).list(slug, {
      limit: 20,
      sortBy: { column: 'name', order: 'asc' },
    });

    if (error) {
      console.log(`  ERROR listing ${slug}/: ${error.message}`);
      skipped++;
      continue;
    }

    const imageFiles = (fileList || [])
      .map(f => f.name)
      .filter(name => {
        if (name.startsWith('.')) return false;
        return IMAGE_EXTS.has(getExt(name));
      });

    if (imageFiles.length === 0) {
      console.log(`  SKIP: ${slug} — no image files found`);
      skipped++;
      continue;
    }

    const result = matchFiles(imageFiles, m.optionAText || '', m.optionBText || '');

    if (result.method === 'none' && !result.fileA && !result.fileB) {
      console.log(`  AMBIGUOUS: ${slug} — ${imageFiles.length} files, couldn't map`);
      ambiguous++;
      continue;
    }

    if (!result.fileA || !result.fileB) {
      console.log(`  PARTIAL: ${slug} — A=${result.fileA || 'MISSING'}, B=${result.fileB || 'MISSING'}`);
      partial++;
      if (!result.fileA && !result.fileB) continue;
    }

    const urlA = result.fileA ? `${baseUrl}/${slug}/${result.fileA}` : null;
    const urlB = result.fileB ? `${baseUrl}/${slug}/${result.fileB}` : null;

    let urlsValid = true;
    if (urlA) {
      const ok = await validateUrl(urlA);
      if (!ok) { console.log(`  WARN: URL not accessible: ${urlA}`); urlsValid = false; validationFailed++; }
      else validated++;
    }
    if (urlB) {
      const ok = await validateUrl(urlB);
      if (!ok) { console.log(`  WARN: URL not accessible: ${urlB}`); urlsValid = false; validationFailed++; }
      else validated++;
    }

    console.log(`  ${result.warning ? 'WARN' : 'OK'}: ${slug} [${result.method}]`);
    console.log(`        A: ${result.fileA || 'NONE'} → ${urlA || 'N/A'}`);
    console.log(`        B: ${result.fileB || 'NONE'} → ${urlB || 'N/A'}`);
    if (result.warning) console.log(`        ⚠ ${result.warning}`);

    if (!DRY_RUN && urlsValid) {
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
  console.log(`  Skipped (no files/no slug): ${skipped + noSlug.length}`);
  console.log(`  Partial (1 image only): ${partial}`);
  console.log(`  Ambiguous (couldn't map): ${ambiguous}`);
  console.log(`  URLs validated OK: ${validated}`);
  console.log(`  URL validation failures: ${validationFailed}`);
  console.log(`  DRY_RUN: ${DRY_RUN}`);
  if (DRY_RUN) {
    console.log(`\n  To apply: DRY_RUN=false npx tsx server/scripts/repair-matchup-images.ts\n`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
