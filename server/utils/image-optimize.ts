import sharp from "sharp";

export interface OptimizeResult {
  buffer: Buffer;
  contentType: string;
  extension: string;
}

/**
 * Converts any supported image buffer to optimized .webp.
 * Resizes to fit within maxWidth (preserving aspect ratio, never upscales).
 */
export async function optimizeImage(
  input: Buffer,
  options?: { maxWidth?: number; quality?: number },
): Promise<OptimizeResult> {
  const { maxWidth = 1200, quality = 80 } = options ?? {};

  const buffer = await sharp(input)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();

  return { buffer, contentType: "image/webp", extension: ".webp" };
}
