/**
 * Format a number with thousands separators (commas)
 * @param value - The number to format
 * @returns Formatted number string with commas (e.g., "515,809")
 */
export function formatNumber(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
