import { useState, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  getDisplayImageUrl,
  getDisplaySrcSet,
} from "@/lib/imageTransform";
import { useMatchupImageCandidates } from "@/lib/imageResolver";
import { imageRevealStatus } from "@/lib/imageReveal";

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
  /** Shown on the gradient when every candidate URL fails. */
  emptyLabel?: string;
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
  emptyLabel,
}: CardImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const handledSrc = useRef<string | null>(null);
  const { src: activeSrc, onError, exhausted } = useMatchupImageCandidates(
    src,
    fallbackSrc,
  );

  const displaySrc = activeSrc
    ? getDisplayImageUrl(activeSrc, width ? { width } : undefined)
    : null;

  const advancePast = (failedSrc: string | null) => {
    if (!failedSrc || handledSrc.current === failedSrc) return;
    handledSrc.current = failedSrc;
    onError();
  };

  useLayoutEffect(() => {
    const status = imageRevealStatus(imgRef.current);
    if (status === "loaded") {
      setLoaded(true);
      return;
    }
    if (status === "error") {
      advancePast(displaySrc);
      return;
    }
    setLoaded(false);
  }, [activeSrc, displaySrc, onError]);

  if (!activeSrc || !displaySrc || exhausted) {
    const initials = (emptyLabel ?? "")
      .split(" ")
      .map((part) => part[0])
      .filter(Boolean)
      .join("")
      .slice(0, 2)
      .toUpperCase();
    return (
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted via-muted/80 to-card dark:from-slate-700 dark:via-slate-800 dark:to-slate-900"
      >
        {initials ? (
          <span className="text-lg font-semibold text-muted-foreground/80">{initials}</span>
        ) : null}
      </div>
    );
  }

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
        ref={imgRef}
        key={displaySrc}
        src={displaySrc}
        srcSet={srcSet}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => advancePast(displaySrc)}
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
          className,
        )}
      />
    </>
  );
}
