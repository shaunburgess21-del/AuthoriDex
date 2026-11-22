import sharp from "sharp";

/** Stay under typical WhatsApp / Facebook preview limits. */
const PNG_MAX_BYTES = 500_000;

/**
 * Encode a 1200×630 card as PNG. Full-color first; quantize only when the
 * photo composite would be too heavy for link-preview crawlers.
 */
export async function encodeOgPng(image: sharp.Sharp): Promise<Buffer> {
  const full = await image.clone().png({ compressionLevel: 9 }).toBuffer();
  if (full.length <= PNG_MAX_BYTES) return full;
  const quantized = await image
    .clone()
    .png({ compressionLevel: 9, palette: true, quality: 75, effort: 8 })
    .toBuffer();
  return quantized.length < full.length ? quantized : full;
}
