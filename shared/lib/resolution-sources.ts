/**
 * Sanitize resolution_sources payloads for World Markets.
 * Drops prediction-market platforms (Polymarket, Kalshi, etc.) and
 * invalid / empty rows. Shared by scout import, admin CMS, and backfill.
 */

export type ResolutionSource = {
  label: string;
  url?: string;
};

const BLOCKED_HOST_FRAGMENTS = [
  "polymarket.com",
  "kalshi.com",
  "predictit.org",
  "metaculus.com",
  "manifold.markets",
];

const BLOCKED_LABEL_FRAGMENTS = [
  "polymarket",
  "kalshi",
  "predictit",
  "metaculus",
  "manifold",
];

function isBlockedUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_HOST_FRAGMENTS.some((f) => lower.includes(f));
}

function isBlockedLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return BLOCKED_LABEL_FRAGMENTS.some((f) => lower.includes(f));
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalize an unknown LLM/admin payload into a clean `{label, url?}[]`.
 * Returns null when nothing usable remains (caller can store null).
 */
export function sanitizeResolutionSources(
  input: unknown,
  opts?: { max?: number },
): ResolutionSource[] | null {
  const max = opts?.max ?? 5;
  if (!Array.isArray(input)) return null;

  const out: ResolutionSource[] = [];
  const seenLabels = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const label =
      typeof (raw as any).label === "string" ? (raw as any).label.trim() : "";
    if (!label || label.length > 200) continue;
    if (isBlockedLabel(label)) continue;

    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);

    let url: string | undefined;
    if (typeof (raw as any).url === "string") {
      const trimmed = (raw as any).url.trim();
      if (trimmed && isHttpUrl(trimmed) && !isBlockedUrl(trimmed)) {
        url = trimmed.slice(0, 500);
      }
    }

    out.push(url ? { label, url } : { label });
    if (out.length >= max) break;
  }

  return out.length > 0 ? out : null;
}
