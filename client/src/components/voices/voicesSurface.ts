/** Voices page canvas — slightly lighter lane behind borderless feed tiles (dark only). */
export const VOICES_PAGE_CANVAS_CLASS = "dark:bg-[hsl(220_28%_8%)]";

/** Sticky sub-header on Voices — matches canvas with blur. */
export const VOICES_PAGE_HEADER_CLASS = "dark:bg-[hsl(220_28%_8%)]/80";

/** Dark fill for Voices feed tiles, composer, and post overlay panel. */
export const VOICES_TILE_FILL_CLASS = "dark:bg-[#10141B]";

/** Borderless feed tile on the Voices canvas. */
export const VOICES_FEED_SURFACE_CLASS =
  `rounded-xl border-0 shadow-none ${VOICES_TILE_FILL_CLASS} hover-elevate`;

/** Composer tile — matches feed tiles. */
export const VOICES_COMPOSER_SURFACE_CLASS =
  `rounded-xl border-0 shadow-none ${VOICES_TILE_FILL_CLASS} hover-elevate`;

/** Flat textarea styling inside Voices composer surfaces. */
export const VOICES_COMPOSER_INPUT_CLASS =
  "bg-transparent dark:bg-transparent border-border/20 dark:border-white/[0.08]";

/** Modal panel for timeline post detail — same tile fill as feed/composer. */
export const VOICES_PANEL_SURFACE_CLASS =
  `overflow-hidden rounded-xl border-0 shadow-2xl ${VOICES_TILE_FILL_CLASS}`;

export const VOICES_PANEL_HEADER_CLASS =
  "border-b border-border/40 dark:bg-[#10141B]/95";
