/** Voices page canvas — slightly lighter lane behind borderless feed tiles (dark only). */
export const VOICES_PAGE_CANVAS_CLASS = "dark:bg-[hsl(220_28%_8%)]";

/** Sticky sub-header on Voices — matches canvas with blur. */
export const VOICES_PAGE_HEADER_CLASS = "dark:bg-[hsl(220_28%_8%)]/80";

/** Dark fill for Voices feed tiles, composer, and post overlay panel. */
export const VOICES_TILE_FILL_CLASS = "dark:bg-[#10141B]";

/**
 * Continuous flat feed lane (X-style timeline): one shared surface holding the
 * composer + every post, separated by hairline dividers instead of bubbles.
 * Edge-to-edge on mobile; rounded lane on sm+.
 */
export const VOICES_FEED_LANE_CLASS =
  `divide-y divide-border/40 bg-card sm:rounded-xl ${VOICES_TILE_FILL_CLASS}`;

/** Avatar + content row inside a post/composer (X-style tight gutter). */
export const VOICES_ROW_INNER_CLASS = "flex items-start gap-2";

/** Flat post row inside the feed lane (replaces the per-post bubble). */
export const VOICES_POST_ROW_CLASS =
  "px-1.5 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.03] sm:px-4";

/** Flat textarea styling inside Voices composer surfaces. */
export const VOICES_COMPOSER_INPUT_CLASS =
  "bg-transparent dark:bg-transparent border-border/20 dark:border-white/[0.08]";

/**
 * Panel for timeline post detail — full-screen sheet on mobile, rounded modal
 * on sm+. Same tile fill as the feed lane.
 */
export const VOICES_PANEL_SURFACE_CLASS =
  `overflow-hidden rounded-none border-0 shadow-2xl sm:rounded-xl ${VOICES_TILE_FILL_CLASS}`;

export const VOICES_PANEL_HEADER_CLASS =
  "border-b border-border/40 dark:bg-[#10141B]/95";
