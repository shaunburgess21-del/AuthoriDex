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
 * Format an AMM market's user-credit volume into a compact Polymarket-style
 * chip — e.g. `850 cr`, `1.2K cr`, `12K cr`, `1.5M cr`. Returns `null` when
 * the value isn't finite or is non-positive, so callers can decide whether
 * to render the chip at all (parimutuel markets, fresh AMM markets with no
 * trades yet, etc.).
 */
export function formatVolumeCredits(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value < 1_000) return `${Math.round(value)} cr`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K cr`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M cr`;
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
 * @returns Formatted net worth string (e.g., "$2.6B", "$450M")
 */
export function formatNetWorth(value: string | number): string {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();

    if (lower.includes('not available') ||
        lower.includes('unavailable') ||
        lower.includes('unknown') ||
        lower.includes('n/a') ||
        lower.includes('exact current figure')) {
      return 'Not publicly disclosed';
    }

    if (lower.includes('billion') || lower.includes('million')) {
      return value;
    }

    if (lower.includes('thousand')) {
      const numMatch = value.match(/[\d.]+/);
      if (numMatch) {
        const num = parseFloat(numMatch[0]) * 1_000;
        if (!isNaN(num)) return formatNetWorthNumber(num);
      }
    }

    if (value.includes('$') && /[BMTK]\b/i.test(value)) {
      return value;
    }

    const numMatch = value.replace(/[,$]/g, '').match(/[\d.]+/);
    if (numMatch) {
      const num = parseFloat(numMatch[0]);
      if (!isNaN(num)) {
        return formatNetWorthNumber(num);
      }
    }

    return value;
  }

  return formatNetWorthNumber(value);
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
