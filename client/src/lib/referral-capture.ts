/**
 * Landing-time helpers for the shares + referral funnel.
 *
 * Two responsibilities:
 *
 *   1. Capture `?ref=` from the inbound URL and stash it in
 *      localStorage with a 30-day expiry. AuthContext's syncProfile
 *      reads the stash on signup and forwards it to
 *      /api/profile/sync, which sets profiles.referred_by.
 *
 *   2. Capture `?sharer=` from the inbound URL and POST to
 *      /api/share/track-click so the share-link credit can land.
 *      This fires once per page load, then the params are stripped
 *      from the URL via history.replaceState so a refresh doesn't
 *      re-fire the ping.
 *
 * Both are best-effort — failures are logged but never block render.
 */

const REFERRAL_LS_KEY = "voxdex_referral_code";
const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredReferral {
  code: string;
  expiresAt: number;
}

function readStoredReferral(): StoredReferral | null {
  try {
    const raw = window.localStorage.getItem(REFERRAL_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReferral>;
    if (!parsed?.code || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt < Date.now()) {
      window.localStorage.removeItem(REFERRAL_LS_KEY);
      return null;
    }
    return { code: parsed.code, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/**
 * Read the persisted referral code (if non-expired). Used by
 * AuthContext's syncProfile to forward the code to the server on
 * the create-profile path.
 */
export function getStoredReferralCode(): string | null {
  if (typeof window === "undefined") return null;
  return readStoredReferral()?.code ?? null;
}

export function clearStoredReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REFERRAL_LS_KEY);
  } catch {
    // localStorage can throw in private modes — silent noop.
  }
}

/**
 * Capture `?ref=VX...` from the current URL into localStorage.
 *
 * - Only stores valid-looking codes (VX + 6 base32-ish chars).
 * - Does not overwrite a non-expired existing stash — first-touch
 *   attribution wins. A user who clicks two friends' links over
 *   the course of a week credits the first friend.
 * - Strips `ref` from the URL after capture so refreshes don't keep
 *   it in the address bar (and so the param isn't accidentally
 *   shared if the user copies the URL).
 */
export function captureReferralFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (!ref) return;
    const normalised = ref.trim().toUpperCase();
    if (!/^VX[A-Z0-9]{6}$/.test(normalised)) {
      url.searchParams.delete("ref");
      window.history.replaceState({}, "", url.toString());
      return;
    }

    const existing = readStoredReferral();
    if (!existing) {
      const payload: StoredReferral = {
        code: normalised,
        expiresAt: Date.now() + REFERRAL_TTL_MS,
      };
      try {
        window.localStorage.setItem(REFERRAL_LS_KEY, JSON.stringify(payload));
      } catch {
        // Quota exceeded / private mode — silent.
      }
    }

    url.searchParams.delete("ref");
    window.history.replaceState({}, "", url.toString());
  } catch (err) {
    console.warn("[referral] captureReferralFromUrl failed", err);
  }
}

/**
 * Capture `?sharer=` from the current URL and ping the click-
 * tracking endpoint. Fires at most once per page load:
 *
 *   - Skips when the current viewer matches the sharer (a user
 *     can't credit themselves for their own share).
 *   - Strips the `sharer` / `utm_*` params from the URL after the
 *     ping so a hard refresh doesn't re-fire.
 */
export async function captureShareClickFromUrl(currentUserId: string | null | undefined): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const sharerUserId = url.searchParams.get("sharer");
    if (!sharerUserId) return;

    // Strip params eagerly — even if the ping fails we don't want
    // a refresh to fire it again.
    const surface = url.searchParams.get("utm_campaign") ?? "unknown";
    const shareUrl = url.toString();
    url.searchParams.delete("sharer");
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    window.history.replaceState({}, "", url.toString());

    // Self-share guard. We still strip params (above) so the URL
    // shape is consistent regardless of viewer.
    if (currentUserId && currentUserId === sharerUserId) return;

    await fetch("/api/share/track-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        sharerUserId,
        surface,
        shareUrl,
      }),
    });
  } catch (err) {
    console.warn("[share-click] capture failed", err);
  }
}
