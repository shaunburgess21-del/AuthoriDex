/**
 * Optional Supabase Storage Image Transformation helper.
 *
 * When `VITE_SUPABASE_IMAGE_TRANSFORM` is set to "true" at build time, public
 * Supabase Storage object URLs are rewritten to the on-the-fly render endpoint
 * with width/quality params so each device downloads an appropriately sized
 * WebP instead of one fixed-size file.
 *
 * IMPORTANT: the render endpoint requires a Supabase plan that includes Image
 * Transformations. It is therefore OFF by default — flip the env flag only
 * after confirming plan support, otherwise transformed URLs 400 and fall back
 * through the image error chain. With the flag off this is a pure passthrough,
 * so wiring it in now is behaviour-neutral.
 */
const TRANSFORM_ENABLED =
  import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORM === "true";

const PUBLIC_MARKER = "/storage/v1/object/public/";
const RENDER_MARKER = "/storage/v1/render/image/public/";

export interface ImageTransformOptions {
  /** Target render width in CSS pixels (Supabase scales height to keep aspect). */
  width?: number;
  /** WebP quality 20-100 (Supabase default 80). */
  quality?: number;
}

/**
 * Returns the URL to actually load for a card/avatar image. Passthrough unless
 * transforms are enabled AND the URL is a Supabase public object URL.
 */
export function getDisplayImageUrl(
  url: string,
  opts?: ImageTransformOptions,
): string {
  if (!TRANSFORM_ENABLED || !url) return url;
  const idx = url.indexOf(PUBLIC_MARKER);
  if (idx === -1) return url;

  const renderUrl = url.replace(PUBLIC_MARKER, RENDER_MARKER);
  const params = new URLSearchParams();
  if (opts?.width) params.set("width", String(Math.round(opts.width)));
  params.set("quality", String(opts?.quality ?? 75));
  return `${renderUrl}?${params.toString()}`;
}

/**
 * Build a `srcset` string (1x/2x) for retina displays. Returns undefined when
 * transforms are disabled (no second variant to point at).
 */
export function getDisplaySrcSet(
  url: string,
  opts: ImageTransformOptions & { width: number },
): string | undefined {
  if (!TRANSFORM_ENABLED || !url) return undefined;
  if (url.indexOf(PUBLIC_MARKER) === -1) return undefined;
  const oneX = getDisplayImageUrl(url, opts);
  const twoX = getDisplayImageUrl(url, { ...opts, width: opts.width * 2 });
  return `${oneX} 1x, ${twoX} 2x`;
}
