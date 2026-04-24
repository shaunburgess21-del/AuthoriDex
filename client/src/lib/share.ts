import { toast } from "sonner";

export async function sharePage(title: string) {
  const url = window.location.href;

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
    toast.success("Link copied!", { duration: 2500 });
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
      const { dismiss } = toast({
        title: "Image copied!",
        description: "Paste it into X, Instagram, or anywhere else.",
      });
      setTimeout(() => dismiss(), 3500);
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
    const { dismiss } = toast({
      title: "Image downloaded",
      description: "Find it in your downloads and share it wherever.",
    });
    setTimeout(() => dismiss(), 3500);
    return { status: "downloaded", via: "download" };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    toast({ title: "Couldn't share image", variant: "destructive" });
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
