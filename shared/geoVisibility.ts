import { z } from "zod";
import { isValidCountryCode } from "./countries";

export const VISIBLE_COUNTRIES_MAX = 30;

export const visibleCountriesSchema = z
  .array(z.string().regex(/^[A-Z]{2}$/))
  .max(VISIBLE_COUNTRIES_MAX)
  .default([]);

/**
 * Normalize API/admin input into a deduped uppercase ISO allowlist.
 * Invalid codes are dropped; empty input yields [] (global visibility).
 */
export function sanitizeVisibleCountries(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const code = item.trim().toUpperCase();
    if (!isValidCountryCode(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= VISIBLE_COUNTRIES_MAX) break;
  }
  return out;
}

/** True when card has no geo restriction (empty or missing allowlist). */
export function isGloballyVisible(
  visibleCountries: string[] | null | undefined,
): boolean {
  return !visibleCountries || visibleCountries.length === 0;
}

/**
 * Whether a card should be shown to a viewer based on country of residence.
 * - Empty allowlist → everyone
 * - Non-empty allowlist → only matching residence; missing residence → hidden
 */
export function isCardVisibleToUser(
  visibleCountries: string[] | null | undefined,
  userResidence: string | null | undefined,
): boolean {
  if (isGloballyVisible(visibleCountries)) return true;
  if (!userResidence) return false;
  const residence = userResidence.trim().toUpperCase();
  return visibleCountries!.some((c) => c.toUpperCase() === residence);
}
