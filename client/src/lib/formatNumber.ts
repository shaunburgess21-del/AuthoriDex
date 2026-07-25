import { formatVoxCompact } from "./currency";

/**
 * Format a number with thousands separators (commas)
 * @param value - The number to format
 * @returns Formatted number string with commas (e.g., "515,809")
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString('en-US');
}

export function compactNumber(num: number, decimals = 0): string {
  if (!Number.isFinite(num)) return "0";
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${(num / 1_000).toFixed(decimals).replace(/\.0$/, '')}k`;
  return Math.round(num).toString();
}

export function formatDelta(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function compactVotes(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return count.toString();
}

/**
 * Format an AMM market's Vox volume into a compact Polymarket-style
 * chip — e.g. `Ꝟ850`, `Ꝟ1.2K`, `Ꝟ12K`, `Ꝟ1.5M`. Returns `null` when
 * the value isn't finite or is non-positive, so callers can decide whether
 * to render the chip at all (fresh AMM markets with no trades yet, etc.).
 *
 * Thin wrapper around `formatVoxCompact` — kept as a separate export
 * so the dozens of `formatVolumeCredits(...)` call sites don't need
 * to be renamed in lockstep with the Credits→Vox display rename.
 * New code should call `formatVoxCompact` directly.
 */
export function formatVolumeCredits(value: number | null | undefined): string | null {
  return formatVoxCompact(value);
}

const APPROVAL_SEGMENT_COLORS = ['#FF0000', '#FF9100', '#FFC400', '#76FF03', '#00C853'];

/** Returns a color for approval rating (1-5) or percentage (0-100). */
export function getApprovalColor(ratingOrPct: number): string {
  if (!Number.isFinite(ratingOrPct)) return APPROVAL_SEGMENT_COLORS[2];
  const rating = ratingOrPct > 5 ? Math.round((ratingOrPct / 100) * 4) + 1 : Math.round(ratingOrPct);
  const clampedRating = Math.max(1, Math.min(5, rating));
  return APPROVAL_SEGMENT_COLORS[clampedRating - 1];
}

/**
 * Format a net worth string to be more readable
 * Converts large numbers to B/M format and handles various input formats
 * @param value - The net worth value (number or string)
 * @returns Formatted net worth string (e.g., "$2.6B", "$450M", "$5-$18M")
 */
export function formatNetWorth(value: string | number): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();

    if (lower.includes('not available') ||
        lower.includes('unavailable') ||
        lower.includes('unknown') ||
        lower.includes('n/a') ||
        lower.includes('exact current figure') ||
        lower.includes('no reliable estimate')) {
      return 'No reliable estimate found';
    }

    // Ranges: "$5-$18 million", "$5 million-$18 million", "$200 million-$6.5 billion"
    const rangeMatch = trimmed.match(
      /^\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])?\s*[-–—to]+\s*\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])?\s*$/i,
    );
    if (rangeMatch) {
      const lowUnit = rangeMatch[2] || rangeMatch[4];
      const highUnit = rangeMatch[4] || rangeMatch[2];
      const low = parseUnitAmount(rangeMatch[1], lowUnit);
      const high = parseUnitAmount(rangeMatch[3], highUnit);
      if (low != null && high != null) {
        return `${formatNetWorthNumber(low)}-${formatNetWorthNumber(high)}`;
      }
    }

    if (lower.includes('billion') || lower.includes('million') || lower.includes('thousand') || lower.includes('trillion')) {
      const single = trimmed.match(
        /^\$?\s*([\d,.]+)\s*(trillion|billion|million|thousand|[KMBT])\s*$/i,
      );
      if (single) {
        const usd = parseUnitAmount(single[1], single[2]);
        if (usd != null) return formatNetWorthNumber(usd);
      }
      // Already a readable long-form estimate we couldn't fully normalize — keep it.
      return trimmed;
    }

    if (trimmed.includes('$') && /[BMTK]\b/i.test(trimmed)) {
      return trimmed;
    }

    const numMatch = trimmed.replace(/[,$]/g, '').match(/[\d.]+/);
    if (numMatch) {
      const num = parseFloat(numMatch[0]);
      if (!isNaN(num)) {
        return formatNetWorthNumber(num);
      }
    }

    return trimmed;
  }

  return formatNetWorthNumber(value);
}

function parseUnitAmount(rawNum: string, rawUnit: string | undefined): number | null {
  const num = parseFloat(rawNum.replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const unit = (rawUnit ?? '').toLowerCase();
  if (unit === 'trillion' || unit === 't') return num * 1e12;
  if (unit === 'billion' || unit === 'b') return num * 1e9;
  if (unit === 'million' || unit === 'm') return num * 1e6;
  if (unit === 'thousand' || unit === 'k') return num * 1e3;
  return num;
}

function formatNetWorthNumber(num: number): string {
  if (num >= 1_000_000_000_000) {
    return `$${(num / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')}T`;
  }
  if (num >= 1_000_000_000) {
    return `$${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (num >= 1_000_000) {
    return `$${(num / 1_000_000).toFixed(0)}M`;
  }
  if (num >= 1_000) {
    return `$${(num / 1_000).toFixed(0)}K`;
  }
  return `$${num.toFixed(0)}`;
}
