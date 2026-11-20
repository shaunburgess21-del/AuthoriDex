/**
 * Whether a decoded <img> already finished before React attached onLoad.
 * Cached photos (home → Voices, repeat visits) often complete synchronously,
 * and the load event is then missed — leaving the placeholder up forever.
 */
export function imageRevealStatus(
  img: { complete: boolean; naturalWidth: number } | null | undefined,
): "loaded" | "error" | "pending" {
  if (!img || !img.complete) return "pending";
  return img.naturalWidth > 0 ? "loaded" : "error";
}
