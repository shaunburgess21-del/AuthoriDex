/**
 * Mobile home pulse cards (Daily Movers, Weekly Gainers / "Momentum · 7d",
 * Weekly Droppers). Each card used to size to its content, which on a
 * ~402pt phone grew past the content box and left the Weekly Gainers card
 * cut off on the right. The card is now at most 20rem and at most the
 * scrollport (`w-[min(100%,20rem)]`), with `px-2` (8px) gutters.
 */

export const HOME_PULSE_CARD_MAX_PX = 320;
export const HOME_PULSE_GUTTER_PX = 8;
/** iPhone 18 Pro logical width. */
export const IPHONE_18_PRO_WIDTH_PX = 402;

export function homePulseContentWidth(
  viewportPx: number,
  gutterPx = HOME_PULSE_GUTTER_PX,
): number {
  return Math.max(0, viewportPx - gutterPx * 2);
}

export function homePulseCardWidth(viewportPx: number): number {
  return Math.min(homePulseContentWidth(viewportPx), HOME_PULSE_CARD_MAX_PX);
}

/** The card's right edge sits inside the content box. */
export function homePulseCardFits(viewportPx: number): boolean {
  const content = homePulseContentWidth(viewportPx);
  const width = homePulseCardWidth(viewportPx);
  return content > 0 && width > 0 && width <= content;
}
