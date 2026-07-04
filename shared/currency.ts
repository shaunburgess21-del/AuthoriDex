/**
 * Vox — the in-app virtual currency.
 *
 * Single source of truth for the currency's name, symbol, and the
 * formatting helpers every display surface should use. Imported by
 * both client and server (welcome email, notification bodies, etc.).
 *
 * Voice rule (hybrid, symbol-forward):
 *   - Symbol-prefix in chips, charts, price-per-share, deltas,
 *     notifications, ledger rows: `Ꝟ500`, `−Ꝟ500`, `Ꝟ0.52/share`.
 *   - The word "Vox" in headings, prose, balance labels, CTAs, emails:
 *     "Buy Vox", "Your balance: 9,510 Vox", "10,000 Vox to start".
 *   - Default to the symbol when a number sits next to the currency.
 *     Use the word when it reads as a noun in a sentence.
 *
 * "Vox" is a mass noun. Never pluralise to "Voxes". Treat it like
 * "cash" or Manifold's "Mana".
 *
 * DB columns (users.predict_credits, credit_ledger, credit_actions)
 * keep their existing names — they are internal identifiers, not
 * labels. Only the display layer renames.
 */

/** Latin Capital Letter V with Diagonal Stroke. The Vox glyph. */
const VOX_SYMBOL = "\u{A75E}";

export const CURRENCY = {
  /** Long-form noun used in prose, headings, balance labels, CTAs. */
  name: "Vox",
  /** Unicode glyph used in tight UI next to numbers. */
  symbol: VOX_SYMBOL,
  /**
   * HTML rendering of the symbol. Identical to the plain symbol for
   * now; kept as a separate constant so we can swap to an inline
   * `<img>` fallback in email HTML later if any client tofu-boxes
   * the glyph, without touching every call site.
   */
  symbolHtml: VOX_SYMBOL,
} as const;

/** Hosted PNG for email clients that cannot render U+A75E (e.g. iOS Mail). */
export const VOX_MARK_EMAIL_PATH = "/fonts/vox-mark-email.png";

export function voxMarkEmailUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${VOX_MARK_EMAIL_PATH}`;
}

/** Display size in email headers; source PNG is 128px for retina. */
export const VOXDEX_LOGO_EMAIL_DISPLAY_PX = 32;

function formatIntEmail(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(Math.abs(n)).toLocaleString("en-US");
}

export type VoxAmountEmailVariant = "positive" | "negative" | "parens";

/**
 * Plain-text amount fragment for email (glyph rendered separately via Img).
 *   positive → "+471"
 *   negative → "−500"
 *   parens   → "500" (caller wraps with parens around mark+amount)
 */
export function formatVoxAmountEmail(
  amount: number,
  variant: VoxAmountEmailVariant,
): string {
  const n = formatIntEmail(amount);
  if (variant === "positive") return `+${n}`;
  if (variant === "negative") return `\u2212${n}`;
  if (amount < 0) return `\u2212${n}`;
  return n;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Format a whole-number Vox amount with the symbol prefix.
 * `9510` → `"Ꝟ9,510"`. Negative values get a Unicode minus sign so
 * the spacing matches `+` in deltas (see `formatVoxDelta`).
 */
export function formatVox(n: number): string {
  if (!Number.isFinite(n)) return `${CURRENCY.symbol}0`;
  if (n < 0) return `\u2212${CURRENCY.symbol}${formatInt(Math.abs(n))}`;
  return `${CURRENCY.symbol}${formatInt(n)}`;
}

/**
 * Compact form for volume chips and high-density displays.
 * `850` → `"Ꝟ850"`, `1234` → `"Ꝟ1.2K"`, `45_049` → `"Ꝟ45K"`,
 * `1_500_000` → `"Ꝟ1.5M"`. Returns `null` for non-finite or
 * non-positive values so callers can skip rendering the chip on
 * fresh markets with no volume yet (matches the old
 * `formatVolumeCredits` contract).
 */
export function formatVoxCompact(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  if (n < 1_000) return `${CURRENCY.symbol}${Math.round(n)}`;
  if (n < 1_000_000) {
    return `${CURRENCY.symbol}${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${CURRENCY.symbol}${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * Signed delta with two decimal places — for P&L rows, position
 * change copy, ledger entries.
 *   `+5`     → `"+Ꝟ5.00"`
 *   `-1.234` → `"−Ꝟ1.23"`
 *   `0`      → `"Ꝟ0.00"`
 *
 * Values inside half a cent of zero clamp to `"Ꝟ0.00"` so we never
 * render the slightly absurd `"−Ꝟ0.00"` that comes out of
 * floating-point AMM math.
 */
export function formatVoxDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return `${CURRENCY.symbol}0.00`;
  if (Math.abs(n) < 0.005) return `${CURRENCY.symbol}0.00`;
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${CURRENCY.symbol}${abs}`;
  return `\u2212${CURRENCY.symbol}${abs}`;
}

/**
 * Fractional price for per-share AMM quotes.
 *   `0.517` → `"Ꝟ0.52"` (default 2dp)
 *   `0.517, 3` → `"Ꝟ0.517"`
 *
 * Unlike `formatVoxDelta`, no sign prefix — prices are always
 * positive in LMSR. Negative inputs render with a `−` for safety.
 */
export function formatVoxPrice(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return `${CURRENCY.symbol}0.${"0".repeat(dp)}`;
  if (n < 0) return `\u2212${CURRENCY.symbol}${Math.abs(n).toFixed(dp)}`;
  return `${CURRENCY.symbol}${n.toFixed(dp)}`;
}

/**
 * Long-form rendering: number followed by the word "Vox" (with the
 * thousands-separated number on the left). Use in prose, headings,
 * balance labels, and emails — anywhere the currency reads as a noun.
 *
 * `9510` → `"9,510 Vox"`. No symbol; pair with the symbol via
 * `formatVox` instead when you want the glyph.
 */
export function voxWord(n: number): string {
  return `${formatInt(n)} ${CURRENCY.name}`;
}
