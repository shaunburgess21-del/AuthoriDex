import { cn } from "@/lib/utils";

/**
 * The Vox mark, drawn as a filled inline SVG so it does not depend on a font.
 *
 * U+A75E is missing from Inter and from many Android fonts, which then paint
 * the won sign (₩). A V plus two strokes does the same thing at 10–14px.
 * This mark is an open V — two legs and a point, not a W — crossed by one bar.
 */
export function VoxMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn(
        "inline-block h-[0.9em] w-[0.78em] shrink-0 align-[-0.08em]",
        className,
      )}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path
        fill="currentColor"
        d="M0.8 1.15 L8 15.2 L15.2 1.15 L12.35 1.15 L8 11.7 L3.65 1.15 Z"
      />
      <path
        fill="currentColor"
        d="M5.35 5.15H10.65V7.35H5.35z"
      />
    </svg>
  );
}
