import { cn } from "@/lib/utils";

/**
 * The Vox mark, drawn as an inline SVG so it does not depend on a font.
 *
 * U+A75E (V with a diagonal stroke) is missing from Inter and from many
 * Android system fonts. Those devices paint a fallback that looks like the
 * won sign (₩). An em-sized SVG uses currentColor, so it tracks the
 * surrounding text in the browser and in the Capacitor Android WebView
 * without loading a webfont.
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
        d="M2.4 2.1 L8 13.6 L13.6 2.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      />
      <path
        d="M10.7 2.3 L6.15 8.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
