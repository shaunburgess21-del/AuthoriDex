import { supabaseServer } from "../supabase";

const BUCKET_NAME = "public-images";
const TARGET_SIZE_LIMIT = 5 * 1024 * 1024;

let bucketEnsured = false;

/**
 * Ensure the public-images bucket exists with sane limits.
 * Result is cached for the process lifetime to avoid a listBuckets()
 * round-trip on every admin upload (which can be slow or time out).
 */
export async function ensurePublicImagesBucket(): Promise<void> {
  if (bucketEnsured) return;

  const { data: buckets, error: listError } = await supabaseServer.storage.listBuckets();
  if (listError) {
    throw new Error(`Storage unavailable: ${listError.message}`);
  }

  const existingBucket = buckets?.find((b) => b.name === BUCKET_NAME);
  if (!existingBucket) {
    const { error: createError } = await supabaseServer.storage.createBucket(BUCKET_NAME, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: TARGET_SIZE_LIMIT,
    });
    if (createError) {
      throw new Error(`Failed to create storage bucket: ${createError.message}`);
    }
  } else if (
    existingBucket.file_size_limit !== undefined &&
    existingBucket.file_size_limit !== null &&
    existingBucket.file_size_limit < TARGET_SIZE_LIMIT
  ) {
    await supabaseServer.storage.updateBucket(BUCKET_NAME, {
      public: true,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: TARGET_SIZE_LIMIT,
    });
  }

  bucketEnsured = true;
}

export const PUBLIC_IMAGES_BUCKET = BUCKET_NAME;
