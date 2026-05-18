/**
 * Helpers for HTML `datetime-local` inputs, which use local wall time without a
 * timezone suffix. Do not use `toISOString().slice(0, 16)` — that injects UTC
 * digits into a control that expects local time.
 */

export function dateToLocal(value: unknown): string {
  if (!value) return "";
  try {
    const d = new Date(value as string | number);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

/** Parse a `datetime-local` value as local time and return an ISO UTC string. */
export function localDatetimeToIso(localValue: string): string {
  return new Date(localValue).toISOString();
}
