/**
 * Canonical ethnicity options surfaced on the About Me settings tab.
 * The DB column (`profiles.ethnicity`) is free `text` so legacy
 * free-text values still load; saving from the UI always writes a
 * canonical `value` from this list.
 */

export const ETHNICITY_OPTIONS = [
  { value: "african_black", label: "African / Black" },
  { value: "asian", label: "Asian" },
  { value: "white", label: "White" },
  { value: "coloured", label: "Coloured" },
  { value: "indian", label: "Indian" },
  { value: "middle_eastern", label: "Middle Eastern" },
  { value: "hispanic", label: "Hispanic" },
  { value: "indigenous", label: "Indigenous" },
  { value: "pacific_islander", label: "Pacific Islander" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export type EthnicityValue = (typeof ETHNICITY_OPTIONS)[number]["value"];

const ETHNICITY_LOOKUP = new Map<string, string>(
  ETHNICITY_OPTIONS.map((o) => [o.value, o.label]),
);

export function getEthnicityLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return ETHNICITY_LOOKUP.get(value) ?? value;
}

export function isCanonicalEthnicity(value: string): value is EthnicityValue {
  return ETHNICITY_LOOKUP.has(value);
}
