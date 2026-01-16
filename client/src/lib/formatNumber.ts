/**
 * Format a number with thousands separators (commas)
 * @param value - The number to format
 * @returns Formatted number string with commas (e.g., "515,809")
 */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * Format a net worth string to be more readable
 * Converts large numbers to B/M format and handles various input formats
 * @param value - The net worth value (number or string)
 * @returns Formatted net worth string (e.g., "$2.6B", "$450M")
 */
export function formatNetWorth(value: string | number): string {
  if (typeof value === 'string') {
    // If already formatted nicely (contains billion, million, $), return as-is
    if (value.toLowerCase().includes('billion') || value.toLowerCase().includes('million')) {
      return value;
    }
    // If it's a formatted currency like "$2.6 billion", return as-is
    if (value.includes('$') && (value.includes('B') || value.includes('M') || value.includes('T'))) {
      return value;
    }
    // Check if it's a "not available" type message
    if (value.toLowerCase().includes('not available') || 
        value.toLowerCase().includes('unavailable') ||
        value.toLowerCase().includes('unknown') ||
        value.toLowerCase().includes('n/a') ||
        value.toLowerCase().includes('exact current figure')) {
      return 'Not publicly disclosed';
    }
    // Try to extract number from string
    const numMatch = value.replace(/[,$]/g, '').match(/[\d.]+/);
    if (numMatch) {
      const num = parseFloat(numMatch[0]);
      if (!isNaN(num)) {
        return formatNetWorthNumber(num);
      }
    }
    // Return cleaned version
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
