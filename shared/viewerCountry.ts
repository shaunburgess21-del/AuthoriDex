import { isValidCountryCode } from "./countries";

/**
 * IP-country codes that hosting edges emit when they do not know a country.
 * Vercel and Cloudflare both use XX; Cloudflare uses T1 for Tor exits.
 * Neither is an ISO 3166-1 alpha-2 residence.
 */
const IGNORED_IP_COUNTRIES = new Set(["XX", "T1"]);

/**
 * Uppercase a hosting geo header into an ISO alpha-2 code we are willing
 * to treat as a viewer country. Empty, XX, T1, and anything that is not a
 * known country code are ignored so a bad header cannot hide global cards
 * or unlock the wrong country's feed.
 */
export function normalizeRequestCountryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  if (!code || IGNORED_IP_COUNTRIES.has(code)) return null;
  if (!isValidCountryCode(code)) return null;
  return code;
}

function readHeaderValue(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const bag = headers as Record<string, string | string[] | undefined>;
  const raw = bag[name] ?? bag[name.toLowerCase()];
  if (Array.isArray(raw)) return typeof raw[0] === "string" ? raw[0] : null;
  return typeof raw === "string" ? raw : null;
}

/**
 * Hosting geo header order: Vercel's own header, then the copy our
 * middleware writes (`x-voxdex-country`) because an external rewrite does
 * not document forwarding `x-vercel-*`, then Cloudflare.
 * The first valid code wins.
 */
const IP_COUNTRY_HEADERS = [
  "x-vercel-ip-country",
  "x-voxdex-country",
  "cf-ipcountry",
] as const;

export function readIpCountry(
  headers: Headers | Record<string, string | string[] | undefined>,
): string | null {
  for (const name of IP_COUNTRY_HEADERS) {
    const code = normalizeRequestCountryCode(readHeaderValue(headers, name));
    if (code) return code;
  }
  return null;
}

/** Stored `countryOfResidence`. Any non-empty value wins over the IP header. */
export function normalizeStoredResidence(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

/**
 * Signed-in residence wins, including when it will not match any allowlist.
 * IP country is only the fallback for anonymous viewers and accounts that
 * have not set a residence.
 */
export function pickViewerCountry(
  countryOfResidence: unknown,
  ipCountry: string | null,
): string | null {
  return normalizeStoredResidence(countryOfResidence) ?? ipCountry;
}

/**
 * Headers the Vercel middleware stamps onto `/api/*` before the Railway
 * rewrite. Null means "delete both" so a client-supplied value cannot
 * survive the Vercel hop when the edge has no real country.
 */
export function countryHeadersFromEdge(
  edgeCountry: unknown,
): { "x-vercel-ip-country": string; "x-voxdex-country": string } | null {
  const country = normalizeRequestCountryCode(edgeCountry);
  if (!country) return null;
  return {
    "x-vercel-ip-country": country,
    "x-voxdex-country": country,
  };
}
