import { useState, type ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface LazyImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  /** When provided alongside `src`, generates a srcset for 1x/2x resolution. */
  highResSrc?: string;
}

/**
 * Drop-in `<img>` replacement with lazy loading, aspect-ratio stability,
 * a fade-in reveal on load, and optional srcset for retina displays.
 */
export function LazyImage({
  className,
  alt = "",
  highResSrc,
  src,
  onError,
  ...props
}: LazyImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const srcSet =
    highResSrc && src ? `${src} 1x, ${highResSrc} 2x` : undefined;

  if (errored) {
    return (
      <div
        className={cn(
          "bg-muted flex items-center justify-center text-muted-foreground text-xs",
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      {...props}
      src={src}
      srcSet={srcSet}
      alt={alt}
      loading="lazy"
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={(e) => {
        setErrored(true);
        onError?.(e);
      }}
      className={cn(
        "transition-opacity duration-300",
        loaded ? "opacity-100" : "opacity-0",
        className,
      )}
    />
  );
}
