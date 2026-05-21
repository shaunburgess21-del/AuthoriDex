import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { celebrityImages } from "@shared/schema";
import { supabaseServer } from "../supabase";
import { syncWinningAvatarForPerson } from "./curateAvatar";

const SLOT_FILE_RE = /^([1-5])\.(webp|jpg|jpeg|png)$/i;
const INDUCTION_STAGING_SOURCES = [
  "induction_storage_sync",
  "induction_storage_upload",
  "induction",
] as const;

export function buildCelebrityLargePublicUrl(supabaseUrl: string, slug: string, filename: string): string {
  return `${supabaseUrl}/storage/v1/object/public/celebrity-large/${encodeURIComponent(slug)}/${filename}`;
}

function buildLeadersLargePublicUrl(supabaseUrl: string, slug: string, filename: string): string {
  return `${supabaseUrl}/storage/v1/object/public/leaders-large/${encodeURIComponent(slug)}/${filename}`;
}

/** Parse bucket + object path from a Supabase public object URL (path segment decoded). */
export function parseSupabasePublicStoragePath(
  imageUrl: string,
): { bucket: string; objectPath: string } | null {
  const publicPrefix = "/storage/v1/object/public/";
  const idx = imageUrl.indexOf(publicPrefix);
  if (idx === -1) return null;
  const afterPrefix = imageUrl.substring(idx + publicPrefix.length);
  const slashIdx = afterPrefix.indexOf("/");
  if (slashIdx === -1) return null;
  const bucket = afterPrefix.substring(0, slashIdx);
  const rawPath = afterPrefix.substring(slashIdx + 1).split("?")[0];
  try {
    return { bucket, objectPath: decodeURIComponent(rawPath) };
  } catch {
    return { bucket, objectPath: rawPath };
  }
}

function filenameFromImageUrl(imageUrl: string): string | null {
  try {
    const raw = new URL(imageUrl).pathname.split("/").filter(Boolean).pop();
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    const raw = imageUrl.split("/").filter(Boolean).pop();
    return raw ? decodeURIComponent(raw.split("?")[0]) : null;
  }
}

function urlMatchesInductionSlugSlot(imageUrl: string, slug: string, storageFilenames: Set<string>): boolean {
  const filename = filenameFromImageUrl(imageUrl);
  if (!filename || !SLOT_FILE_RE.test(filename)) return false;
  if (!storageFilenames.has(filename)) return false;
  for (const bucket of ["celebrity-large", "leaders-large"] as const) {
    const prefix = `/storage/v1/object/public/${bucket}/${encodeURIComponent(slug)}/`;
    if (imageUrl.includes(prefix)) return true;
    const unencodedPrefix = `/storage/v1/object/public/${bucket}/${slug}/`;
    if (imageUrl.includes(unencodedPrefix)) return true;
  }
  return false;
}

type SlotFile = { name: string; publicUrl: string; bucket: "celebrity-large" | "leaders-large" };

async function listInductionSlotFiles(slug: string): Promise<SlotFile[]> {
  const trimmed = slug.trim();
  if (!trimmed) return [];
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) return [];

  const collect = async (bucket: "celebrity-large" | "leaders-large"): Promise<SlotFile[]> => {
    const { data: listed, error } = await supabaseServer.storage.from(bucket).list(trimmed);
    if (error || !listed?.length) return [];
    const acc: SlotFile[] = [];
    for (const file of listed) {
      if (!SLOT_FILE_RE.test(file.name)) continue;
      acc.push({
        name: file.name,
        bucket,
        publicUrl:
          bucket === "celebrity-large"
            ? buildCelebrityLargePublicUrl(supabaseUrl, trimmed, file.name)
            : buildLeadersLargePublicUrl(supabaseUrl, trimmed, file.name),
      });
    }
    return acc;
  };

  let files = await collect("celebrity-large");
  if (files.length === 0) files = await collect("leaders-large");
  return files;
}

/**
 * Remove the storage object behind a public URL. For numbered induction slots, also tries
 * `{imageSlug}/{filename}` when the URL used an encoded slug segment.
 */
export async function removeCelebrityImageFromStorage(
  imageUrl: string,
  imageSlug?: string | null,
): Promise<void> {
  if (!imageUrl.includes("supabase")) return;

  const parsed = parseSupabasePublicStoragePath(imageUrl);
  const pathsToTry = new Set<string>();
  if (parsed) pathsToTry.add(parsed.objectPath);

  const filename = filenameFromImageUrl(imageUrl);
  const slug = (imageSlug || "").trim();
  if (slug && filename && SLOT_FILE_RE.test(filename)) {
    pathsToTry.add(`${slug}/${filename}`);
  }

  const bucketsToTry = new Set<string>();
  if (parsed?.bucket) bucketsToTry.add(parsed.bucket);
  bucketsToTry.add("celebrity-large");
  bucketsToTry.add("leaders-large");

  for (const bucket of bucketsToTry) {
    for (const objectPath of pathsToTry) {
      const { error } = await supabaseServer.storage.from(bucket).remove([objectPath]);
      if (error) {
        console.warn(`[inductionGalleryStorage] remove ${bucket}/${objectPath}:`, error.message);
      }
    }
  }
}

/**
 * One-way + prune sync for a single induction person: add missing slot files from storage,
 * remove staging DB rows whose slot file no longer exists. Never touches admin_upload rows.
 */
export async function syncInductionGalleryForPerson(personId: string, slug: string): Promise<void> {
  const trimmed = (slug || "").trim();
  if (!trimmed) return;

  const slotFiles = await listInductionSlotFiles(trimmed);
  const storageFilenames = new Set(slotFiles.map((f) => f.name));
  const storagePublicUrls = new Set(slotFiles.map((f) => f.publicUrl));

  const existingRows = await db
    .select({ id: celebrityImages.id, imageUrl: celebrityImages.imageUrl, source: celebrityImages.source })
    .from(celebrityImages)
    .where(eq(celebrityImages.personId, personId));

  const existingUrls = new Set(existingRows.map((r) => r.imageUrl));

  for (const f of slotFiles) {
    if (existingUrls.has(f.publicUrl)) continue;
    await db.insert(celebrityImages).values({
      personId,
      imageUrl: f.publicUrl,
      source: "induction_storage_sync",
      isPrimary: false,
      votesUp: 0,
      votesDown: 0,
    });
    existingUrls.add(f.publicUrl);
  }

  const pruneIds: string[] = [];
  for (const row of existingRows) {
    const source = row.source || "";
    if (!INDUCTION_STAGING_SOURCES.includes(source as (typeof INDUCTION_STAGING_SOURCES)[number])) {
      continue;
    }
    if (storagePublicUrls.has(row.imageUrl)) continue;
    if (urlMatchesInductionSlugSlot(row.imageUrl, trimmed, storageFilenames)) continue;
    const filename = filenameFromImageUrl(row.imageUrl);
    if (filename && SLOT_FILE_RE.test(filename)) {
      pruneIds.push(row.id);
      continue;
    }
    if (
      row.imageUrl.includes(`/celebrity-large/`) ||
      row.imageUrl.includes(`/leaders-large/`)
    ) {
      pruneIds.push(row.id);
    }
  }

  if (pruneIds.length) {
    await db.delete(celebrityImages).where(inArray(celebrityImages.id, pruneIds));
  }

  await syncWinningAvatarForPerson(personId);
}
