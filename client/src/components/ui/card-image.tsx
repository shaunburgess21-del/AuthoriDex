import { useState, type SyntheticEvent } from "react";
import { cn } from "@/lib/utils";
import {
  getDisplayImageUrl,
  getDisplaySrcSet,
} from "@/lib/imageTransform";

export interface CardImageProps {
  src: string;
  alt: string;
  className?: string;
  /**
   * Active / above-the-fold card: load immediately with high fetch priority.
   * Off-screen cards stay lazy (and are warmed by the carousel/snap views).
   */
  priority?: boolean;
  /** Display width hint used for responsive transforms (when enabled). */
  width?: number;
  onError?: (e: SyntheticEvent<HTMLImageElement>) => void;
}

/**
 * Image for matchup/option cards. Fixes the "black box before load" by showing
 * a gradient shimmer placeholder until the image paints, then fading it in.
 * Honors the existing error-fallback chain via `onError`.
 *
 * Must be rendered inside a positioned (relative/absolute) container — the
 * placeholder is absolutely positioned to fill it.
 */
export function CardImage({
  src,
  alt,
  className,
  priority = false,
  width,
  onError,
}: CardImageProps) {
  const [loaded, setLoaded] = useState(false);

  const displaySrc = getDisplayImageUrl(src, width ? { width } : undefined);
  const srcSet = width ? getDisplaySrcSet(src, { width }) : undefined;

  return (
    <>
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/70 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"
        />
      )}
      <img
        src={displaySrc}
        srcSet={srcSet}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={onError}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
    </>
  );
}
