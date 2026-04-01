import sharp from "sharp";

export interface OptimizeResult {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width?: number;
  quality?: number;
}

/**
 * Converts any supported image buffer to optimized .webp.
 * Resizes to fit within maxWidth (preserving aspect ratio, never upscales).
 */
export async function optimizeImage(
  input: Buffer,
  options?: {
    maxWidth?: number;
    quality?: number;
    targetBytes?: number;
    minQuality?: number;
    minWidth?: number;
  },
): Promise<OptimizeResult> {
  const {
    maxWidth = 1200,
    quality = 80,
    targetBytes,
    minQuality = 60,
    minWidth = 640,
  } = options ?? {};

  const sourceMeta = await sharp(input).metadata();
  const sourceWidth = sourceMeta.width ?? maxWidth;
  const initialWidth = Math.min(sourceWidth, maxWidth);

  const encode = async (width: number, q: number) => {
    const buffer = await sharp(input)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: q })
      .toBuffer();
    return { buffer, width, quality: q };
  };

  // Fast path when we don't need strict byte targeting.
  if (!targetBytes) {
    const out = await encode(initialWidth, quality);
    return {
      buffer: out.buffer,
      contentType: "image/webp",
      extension: ".webp",
      width: out.width,
      quality: out.quality,
    };
  }

  // Quality-first search to preserve detail, then width fallback if needed.
  const qualityCandidates: number[] = [];
  for (let q = quality; q >= minQuality; q -= 4) qualityCandidates.push(q);
  if (!qualityCandidates.includes(minQuality)) qualityCandidates.push(minQuality);

  const widthCandidates: number[] = [];
  for (let w = initialWidth; w >= minWidth; w = Math.floor(w * 0.9)) {
    widthCandidates.push(w);
    if (w === minWidth) break;
    if (w < minWidth) break;
  }
  if (!widthCandidates.includes(minWidth)) widthCandidates.push(minWidth);

  let best = await encode(initialWidth, quality);
  if (best.buffer.length <= targetBytes) {
    return {
      buffer: best.buffer,
      contentType: "image/webp",
      extension: ".webp",
      width: best.width,
      quality: best.quality,
    };
  }

  for (const w of widthCandidates) {
    for (const q of qualityCandidates) {
      const candidate = await encode(w, q);
      // Keep smallest as fallback if target can't be reached.
      if (candidate.buffer.length < best.buffer.length) best = candidate;
      if (candidate.buffer.length <= targetBytes) {
        return {
          buffer: candidate.buffer,
          contentType: "image/webp",
          extension: ".webp",
          width: candidate.width,
          quality: candidate.quality,
        };
      }
    }
  }

  throw new Error(
    `Could not compress image below ${Math.floor(targetBytes / 1024)}KB without dropping below quality safeguards. Please upload a smaller image.`,
  );
}
