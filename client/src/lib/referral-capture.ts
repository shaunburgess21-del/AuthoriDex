/**
 * Landing-time helpers for the shares + referral funnel.
 *
 * Two responsibilities, kept on separate paths so a share click
 * never takes the place of sign-up attribution:
 *
 *   1. Capture `?ref=` from the inbound URL and stash it in
 *      localStorage with a 30-day expiry. AuthContext's syncProfile
 *      reads the stash on signup and forwards it to
 *      /api/profile/sync, which sets profiles.referred_by.
 *      `captureReferralFromUrl` is the only writer of that stash.
 *
 *   2. When the landing URL is a share (`ref` plus utm, or a legacy
 *      `sharer` UUID), POST once to /api/share/track-click. New links
 *      send `{ referralCode }`. Links already in the wild still send
 *      `{ sharerUserId }`. Both send `referrer` (document.referrer at
 *      landing, before the query string is cleaned). UTM and `sharer`
 *      are stripped here; `ref` is left for step 1 to stash and strip.
 *
 * Both are best-effort — failures are logged but never block render.
 */

import { SUPABASE_AUTH_STORAGE_KEY, hasPersistedAuthSession } from "@/lib/authSession";
import { cachedShareReferralCode } from "@/lib/share";

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

const SHARE_REFERRAL_CODE_PATTERN = /^VX[A-Z0-9]{6}$/;

interface PendingShareClick {
  mode: "referral" | "legacy";
  referralCode: string | null;
  sharerUserId: string | null;
  surface: string;
  shareUrl: string;
  /**
   * document.referrer at landing, before this module strips sharer/utm.
   * The track-click POST is same-origin, so the Referer header is the
   * VoxDex page and would look internal. This snapshot is the page that
   * sent the visitor. The server treats it as advisory.
   */
  referrer: string;
  posted: boolean;
}

const MAX_LANDING_REFERRER_LEN = 2048;

/** Snapshot the inbound referrer. Empty when the browser has none. */
function readLandingReferrer(): string {
  if (typeof document === "undefined" || typeof document.referrer !== "string") return "";
  return document.referrer.slice(0, MAX_LANDING_REFERRER_LEN);
}

let pendingShareClick: PendingShareClick | null = null;

function shareMarkersPresent(params: URLSearchParams): boolean {
  return (
    params.has("utm_source") ||
    params.has("utm_medium") ||
    params.has("utm_campaign") ||
    params.has("sharer")
  );
}

function normaliseShareReferralCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalised = code.trim().toUpperCase();
  return SHARE_REFERRAL_CODE_PATTERN.test(normalised) ? normalised : null;
}

/**
 * Bearer token already in the persisted session, without booting
 * the Supabase client. The server uses it for the self-credit guard.
 * A missing or unreadable session sends the click anonymously.
 */
function shareClickAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  if (!hasPersistedAuthSession()) return {};
  try {
    const raw = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    if (typeof parsed.access_token === "string" && parsed.access_token.length > 0) {
      return { Authorization: `Bearer ${parsed.access_token}` };
    }
  } catch {
    // Private mode or a torn session — the click still records.
  }
  return {};
}

/** Test isolation. Production call sites never need this. */
export function resetShareClickCaptureForTests(): void {
  pendingShareClick = null;
}

/**
 * Read a share-click off the current URL and strip `sharer` / `utm_*`.
 * Leaves `ref` in place so `captureReferralFromUrl` can stash it for
 * sign-up exactly as before. Call this before that stash runs.
 *
 * A bare `?ref=` (copied referral link, no share markers) is not a
 * click and is left entirely to the sign-up capture.
 */
export function armShareClickFromUrl(): void {
  if (typeof window === "undefined") return;
  // Capture before history.replaceState strips sharer / utm. The
  // referrer is the previous page, not our query string, but this
  // runs at landing so a later navigation cannot replace it.
  const referrer = readLandingReferrer();
  try {
    const url = new URL(window.location.href);
    const sharerRaw = url.searchParams.get("sharer");
    const sharerUserId = sharerRaw && sharerRaw.length > 0 ? sharerRaw : null;
    const referralCode = normaliseShareReferralCode(url.searchParams.get("ref"));
    const marked = shareMarkersPresent(url.searchParams);
    const useReferral = Boolean(referralCode && marked);
    const useLegacy = Boolean(sharerUserId) && !useReferral;
    if (!useReferral && !useLegacy) return;

    const surface = url.searchParams.get("utm_campaign") ?? "unknown";
    const shareUrl = url.toString();
    if (pendingShareClick && pendingShareClick.shareUrl === shareUrl) return;

    url.searchParams.delete("sharer");
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    window.history.replaceState({}, "", url.toString());

    pendingShareClick = {
      mode: useReferral ? "referral" : "legacy",
      referralCode: useReferral ? referralCode : null,
      sharerUserId: useLegacy ? sharerUserId : null,
      surface,
      shareUrl,
      referrer,
      posted: false,
    };
  } catch (err) {
    console.warn("[share-click] capture failed", err);
  }
}

/**
 * POST the armed share click. Fires at most once per armed URL.
 *
 * Self-click skip: a legacy `sharer` equal to the signed-in user id
 * is not posted. A `ref` equal to the signed-in user's own referral
 * code (when that code is already cached) is not posted. Otherwise
 * the request includes the Bearer token so the server can refuse a
 * self-credit when this client doesn't know the code yet.
 *
 * Does not write the sign-up referral stash and does not strip `ref`.
 */
export async function captureShareClickFromUrl(currentUserId: string | null | undefined): Promise<void> {
  armShareClickFromUrl();
  const pending = pendingShareClick;
  if (!pending || pending.posted) return;
  pending.posted = true;

  try {
    if (pending.mode === "legacy" && currentUserId && currentUserId === pending.sharerUserId) {
      return;
    }
    const ownCode = cachedShareReferralCode();
    if (pending.mode === "referral" && ownCode && ownCode === pending.referralCode) {
      return;
    }

    const authHeaders = shareClickAuthHeaders();
    await fetch("/api/share/track-click", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: JSON.stringify({
        ...(pending.mode === "referral"
          ? { referralCode: pending.referralCode }
          : { sharerUserId: pending.sharerUserId }),
        surface: pending.surface,
        shareUrl: pending.shareUrl,
        referrer: pending.referrer,
      }),
    });
  } catch (err) {
    console.warn("[share-click] capture failed", err);
  }
}
