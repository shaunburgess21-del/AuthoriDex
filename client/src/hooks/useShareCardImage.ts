import { useCallback, useRef, useState } from "react";
import { toPng, toBlob } from "html-to-image";

export interface UseShareCardImageOptions {
  /** Pixel width of the element being snapshot. Used for pixelRatio clamping. */
  width: number;
  /** Pixel height of the element being snapshot. */
  height: number;
  /** Multiplier applied to html-to-image pixelRatio (default 2). */
  pixelRatio?: number;
}

/**
 * Hook that wraps `html-to-image` with a ref and sane defaults for the
 * VoxDex share card pipeline. The caller attaches `cardRef` to a visible
 * (or positionally hidden but laid-out) DOM node and calls `generate()`
 * or `generateDataUrl()` to turn it into a PNG.
 *
 * Notes:
 * - We default `pixelRatio` to 2 for crisp output, but clamp to ~1 for very
 *   large cards (1080+) to stay under mobile memory limits.
 * - `cacheBust: true` because we re-use the same DOM node across aspect
 *   toggles and don't want stale image decodes.
 * - `skipFonts: false` — we rely on the site's Google fonts; html-to-image
 *   embeds stylesheet rules so the snapshot matches the preview.
 */
export function useShareCardImage({ width, height, pixelRatio }: UseShareCardImageOptions) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const effectivePixelRatio = pixelRatio ?? (Math.max(width, height) >= 1080 ? 1.5 : 2);

  const commonOptions = () => ({
    width,
    height,
    pixelRatio: effectivePixelRatio,
    cacheBust: true,
    // Match the share card background so anti-aliased corners don't pick up
    // the page body color.
    backgroundColor: "#0B0B1B",
    style: {
      // The hidden container uses scale(0) to keep it out of layout; reset
      // while rendering so html-to-image captures at true size.
      transform: "none",
      margin: "0",
    } as Record<string, string>,
  });

  const generate = useCallback(async (): Promise<Blob> => {
    if (!cardRef.current) {
      throw new Error("Share card node is not mounted");
    }
    setGenerating(true);
    setError(null);
    try {
      const blob = await toBlob(cardRef.current, commonOptions());
      if (!blob) throw new Error("Failed to generate share image");
      return blob;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, effectivePixelRatio]);

  const generateDataUrl = useCallback(async (): Promise<string> => {
    if (!cardRef.current) {
      throw new Error("Share card node is not mounted");
    }
    setGenerating(true);
    setError(null);
    try {
      return await toPng(cardRef.current, commonOptions());
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, effectivePixelRatio]);

  return {
    cardRef,
    generate,
    generateDataUrl,
    generating,
    error,
  };
}
