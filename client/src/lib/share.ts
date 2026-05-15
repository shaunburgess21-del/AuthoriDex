import { toast } from "sonner";

/**
 * Canonical share-attribution surfaces. Mirrors the `share_surface`
 * column on share_clicks; passed by every call site so the share-
 * funnel admin tab can group clicks by where the link came from.
 *
 * `referral` is reserved for the explicit "Refer a Friend" card —
 * it shares the user's profiles.referralCode link rather than a
 * surface-specific page.
 */
export type ShareSurface =
  | "person_profile"
  | "vote_deck"
  | "matchup"
  | "poll"
  | "market"
  | "prediction_win"
  | "portfolio"
  | "comment"
  | "public_profile"
  | "referral"
  | "share_card";

interface SharePageOptions {
  /** Authenticated sharer's profile id. Anonymous shares pass null. */
  sharerUserId?: string | null;
  /** Surface label — drives utm_campaign and the share_clicks row. */
  surface?: ShareSurface;
  /** Override the URL we share. Defaults to window.location.href. */
  url?: string;
}

/**
 * Append attribution params to a share URL.
 *
 * - `?sharer={userId}` — used by the click-tracking ping to credit
 *   the referrer for confirmed external clicks. Omitted entirely
 *   for anonymous shares (no userId == no attribution).
 * - `&utm_source=voxdex&utm_medium=share&utm_campaign={surface}` —
 *   standard UTM tags so external analytics (and our own admin
 *   share-funnel tab once it exists) can group the inbound traffic.
 *
 * Idempotent: if the URL already has any of these params we leave
 * them in place rather than appending duplicates. This matters for
 * the openShareCard path, where buildTradeShareData has already
 * baked the sharer param into shareUrl.
 */
export function appendShareAttribution(
  baseUrl: string,
  options: { sharerUserId?: string | null; surface?: ShareSurface } = {},
): string {
  try {
    const url = new URL(baseUrl, window.location.origin);
    if (options.sharerUserId && !url.searchParams.has("sharer")) {
      url.searchParams.set("sharer", options.sharerUserId);
    }
    if (!url.searchParams.has("utm_source")) {
      url.searchParams.set("utm_source", "voxdex");
    }
    if (!url.searchParams.has("utm_medium")) {
      url.searchParams.set("utm_medium", "share");
    }
    if (options.surface && !url.searchParams.has("utm_campaign")) {
      url.searchParams.set("utm_campaign", options.surface);
    }
    return url.toString();
  } catch {
    // Fallback for non-absolute URLs that fail the URL constructor.
    return baseUrl;
  }
}

/**
 * Share a page link. Optional `options` lets call sites attach a
 * sharer id + surface so the resulting URL carries attribution
 * params that the click-tracking endpoint can credit.
 *
 * Backward-compatible: existing call sites that pass only `title`
 * still work — they just produce un-attributed shares (which is
 * the right call for anonymous flows).
 */
export async function sharePage(
  title: string,
  options: SharePageOptions = {},
): Promise<void> {
  const baseUrl = options.url ?? window.location.href;
  const url = appendShareAttribution(baseUrl, {
    sharerUserId: options.sharerUserId ?? null,
    surface: options.surface,
  });

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied!", { duration: 1500 });
  } catch {
    toast.error("Could not copy link");
  }
}

/**
 * Outcome of `shareImage`. Callers can use this to render UI hints (e.g.
 * "Image downloaded — paste it on X") or track share funnel analytics later.
 */
export type ShareImageResult =
  | { status: "shared"; via: "native" }
  | { status: "copied"; via: "clipboard" }
  | { status: "downloaded"; via: "download" }
  | { status: "cancelled" }
  | { status: "failed"; error: Error };

interface ShareImageOptions {
  /** Title for `navigator.share` (used on iOS/Android). */
  title?: string;
  /** Optional text that accompanies the image on native share / clipboard. */
  text?: string;
  /** Optional URL posted alongside the image on native share sheets. */
  url?: string;
  /** Filename for the download fallback. Defaults to `voxdex-share.png`. */
  filename?: string;
}

/**
 * Three-step share pipeline for a PNG blob:
 *   1. Try `navigator.share({ files: [...] })` (mobile Safari, Android Chrome)
 *   2. Try `navigator.clipboard.write(ClipboardItem)` (desktop Chromium)
 *   3. Download as a file (universal fallback)
 *
 * Each step is guarded by its own feature detection and try/catch so a
 * failure at step N transparently falls through to step N+1. Users always
 * end up with a usable outcome, with a toast that tells them what happened.
 */
export async function shareImage(
  blob: Blob,
  options: ShareImageOptions = {},
): Promise<ShareImageResult> {
  const filename = options.filename ?? "voxdex-share.png";
  const file = new File([blob], filename, { type: blob.type || "image/png" });

  // Step 1: native share with files (mobile primary path)
  // canShare check is important — iOS/Android will throw rather than return
  // false for unsupported data, so we must guard with `canShare(...)`.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: options.title,
        text: options.text,
        url: options.url,
      });
      return { status: "shared", via: "native" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { status: "cancelled" };
      }
      // Fall through to step 2.
    }
  }

  // Step 2: clipboard image copy (desktop Chromium / modern Edge)
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof (navigator.clipboard as Clipboard).write === "function" &&
    typeof window.ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new window.ClipboardItem({ [blob.type || "image/png"]: blob }),
      ]);
      toast.success("Image copied!", {
        description: "Paste it into X, Instagram, or anywhere else.",
        duration: 2500,
      });
      return { status: "copied", via: "clipboard" };
    } catch {
      // Fall through to step 3.
    }
  }

  // Step 3: universal download fallback
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    // We need the anchor to be in the document in some browsers (Firefox)
    // for the click to fire a download.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a tick to grab the blob before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Image downloaded", {
      description: "Find it in your downloads and share it wherever.",
      duration: 2500,
    });
    return { status: "downloaded", via: "download" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    toast.error("Couldn't share image");
    return { status: "failed", error };
  }
}

/**
 * Copy a blob to the clipboard as an image. Returns true on success so UI
 * can show a transient "Copied" state. Used directly by the share modal's
 * explicit "Copy" button (separate from the main share action).
 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.clipboard === "undefined" ||
    typeof (navigator.clipboard as Clipboard).write !== "function" ||
    typeof window.ClipboardItem === "undefined"
  ) {
    return false;
  }
  try {
    await navigator.clipboard.write([
      new window.ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger a download for a blob. Separate from `shareImage` so the modal's
 * explicit "Download" button stays predictable even on platforms where
 * `navigator.share` would succeed.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Feature detection helpers so the UI can show only the options that will
 * actually succeed on the current device. We intentionally don't call
 * `canShare` with a file here — doing so synchronously requires constructing
 * the blob first, which we want to defer until the user actually clicks.
 */
export function canUseNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  );
}

export function canCopyImageToClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard !== "undefined" &&
    typeof (navigator.clipboard as Clipboard).write === "function" &&
    typeof window !== "undefined" &&
    typeof window.ClipboardItem !== "undefined"
  );
}
