import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  getDisplayImageUrl,
  getDisplaySrcSet,
} from "@/lib/imageTransform";
import { useMatchupImageCandidates } from "@/lib/imageResolver";

export interface CardImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Secondary URL when primary + extension variants all fail (e.g. celebrity avatar). */
  fallbackSrc?: string | null;
  /**
   * Active / above-the-fold card: load immediately with high fetch priority.
   * Off-screen cards stay lazy (and are warmed by the carousel/snap views).
   */
  priority?: boolean;
  /** Display width hint used for responsive transforms (when enabled). */
  width?: number;
}

/**
 * Image for matchup/option cards. Fixes the "black box before load" by showing
 * a gradient shimmer placeholder until the image paints, then fading it in.
 * Cycles .webp → .jpeg → .jpg → .png then optional `fallbackSrc` in React
 * state so parent re-renders do not reset an in-progress error chain.
 *
 * Must be rendered inside a positioned (relative/absolute) container — the
 * placeholder is absolutely positioned to fill it.
 */
export function CardImage({
  src,
  alt,
  className,
  fallbackSrc,
  priority = false,
  width,
}: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const { src: activeSrc, onError, exhausted } = useMatchupImageCandidates(
    src,
    fallbackSrc,
  );

  useEffect(() => {
    setLoaded(false);
  }, [activeSrc]);

  if (!activeSrc || exhausted) {
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-muted via-muted/80 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"
      />
    );
  }

  const displaySrc = getDisplayImageUrl(activeSrc, width ? { width } : undefined);
  const srcSet = width ? getDisplaySrcSet(activeSrc, { width }) : undefined;

  return (
    <>
      {!loaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted via-muted/70 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"
        />
      )}
      <img
        key={displaySrc}
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
