import { Capacitor } from "@capacitor/core";

/**
 * Public origin already used by web/PWA share links and by Android App
 * Links. Capacitor Android serves the bundle from `https://localhost`
 * (`androidScheme: "https"`), so share URLs built from
 * `window.location.origin` must be rewritten before they leave the app.
 */
export const PUBLIC_SHARE_ORIGIN = "https://voxdex.com";

const WEBVIEW_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

const WEBVIEW_ORIGIN_IN_TEXT =
  /(?:https?:\/\/localhost|capacitor:\/\/localhost)(?=\/|\?|#|$)/g;

export interface ShareUrlContext {
  nativeAndroid: boolean;
  currentOrigin: string;
}

/**
 * Android only. iOS WebView already implements `navigator.share`, and the
 * Capacitor Share web implementation drops file payloads, so both stay on
 * the existing Web Share path.
 */
export function isAndroidNativeShare(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function currentShareContext(): ShareUrlContext {
  return {
    nativeAndroid: isAndroidNativeShare(),
    currentOrigin: typeof window !== "undefined" ? window.location.origin : "",
  };
}

/**
 * Origin used when building a share/referral link. Web and iOS keep
 * `window.location.origin`. Android WebView origins become the public host.
 */
export function shareLinkOrigin(currentOrigin: string, nativeAndroid: boolean): string {
  if (nativeAndroid && WEBVIEW_ORIGINS.has(currentOrigin)) return PUBLIC_SHARE_ORIGIN;
  return currentOrigin;
}

export function outboundShareOrigin(currentOrigin: string): string {
  return shareLinkOrigin(currentOrigin, isAndroidNativeShare());
}

/**
 * Rewrite a WebView-origin share URL to `https://voxdex.com`, preserving
 * path, query (`ref`, `sharer`, `utm_*`), and hash. No-op on web, on iOS,
 * and when the URL is already public or points at any other host.
 */
export function toPublicShareUrl(url: string, ctx: ShareUrlContext): string {
  if (!ctx.nativeAndroid) return url;
  if (!WEBVIEW_ORIGINS.has(ctx.currentOrigin)) return url;

  let parsed: URL;
  try {
    parsed = new URL(url, ctx.currentOrigin);
  } catch {
    return url;
  }
  if (!isWebviewShareUrl(parsed)) return url;
  if (parsed.username !== "" || parsed.password !== "" || parsed.port !== "") return url;
  return `${PUBLIC_SHARE_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * `capacitor://localhost` is a non-special URL, so `parsed.origin` is the
 * string `"null"` rather than `capacitor://localhost`. Match the host
 * explicitly. Android's configured scheme is `https://localhost`.
 */
function isWebviewShareUrl(parsed: URL): boolean {
  if (WEBVIEW_ORIGINS.has(parsed.origin)) return true;
  return parsed.protocol === "capacitor:" && parsed.hostname === "localhost";
}

/**
 * ShareCard fallback copy embeds the link in the text body. Rewrite those
 * WebView origins in place and leave the surrounding sentence alone.
 */
export function toPublicShareText(text: string, ctx: ShareUrlContext): string {
  if (!ctx.nativeAndroid || !text) return text;
  if (!WEBVIEW_ORIGINS.has(ctx.currentOrigin)) return text;
  return text.replace(WEBVIEW_ORIGIN_IN_TEXT, PUBLIC_SHARE_ORIGIN);
}

/**
 * Android Share concatenates `text + " " + url` when both are http(s).
 * If the text already contains the URL (ShareCard does this on purpose,
 * so WhatsApp does not append a second copy), pass text only.
 */
export function androidShareFields(input: {
  title?: string;
  text?: string;
  url?: string;
}): { title?: string; text?: string; url?: string } {
  const title = input.title;
  const text = input.text && input.text.length > 0 ? input.text : undefined;
  const url = input.url && input.url.length > 0 ? input.url : undefined;
  if (text && url && text.includes(url)) return { title, text };
  return { title, text, url };
}

/** `@capacitor/share` accepts `file:` URIs only. */
export function fileUriForShare(uri: string): string | null {
  if (uri.startsWith("file:")) return uri;
  if (uri.startsWith("/")) return `file://${uri}`;
  return null;
}

export function isShareCancelled(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "name" in err && (err as { name: unknown }).name === "AbortError") {
    return true;
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : typeof err === "string"
          ? err
          : "";
  return /share cancel+ed/i.test(message);
}

export type SheetShareOutcome = "shared" | "cancelled" | "unavailable";

export async function shareWithAndroidSheet(options: {
  title?: string;
  text?: string;
  url?: string;
  files?: string[];
}): Promise<SheetShareOutcome> {
  if (!isAndroidNativeShare()) return "unavailable";

  const fields = androidShareFields(options);
  const files = (options.files ?? []).map(fileUriForShare).filter((uri): uri is string => uri !== null);
  if (!fields.text && !fields.url && files.length === 0) return "unavailable";

  try {
    const { Share } = await import("@capacitor/share");
    await Share.share({
      title: fields.title,
      text: fields.text,
      url: fields.url,
      files: files.length > 0 ? files : undefined,
      dialogTitle: fields.title?.trim() || "Share",
    });
    return "shared";
  } catch (err) {
    if (isShareCancelled(err)) return "cancelled";
    return "unavailable";
  }
}

export async function cachePngForAndroidShare(blob: Blob, filename: string): Promise<string | null> {
  if (!isAndroidNativeShare()) return null;
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const data = await blobToBase64(blob);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "voxdex-share.png";
    const path = `share/${Date.now()}-${safeName}`;
    const written = await Filesystem.writeFile({
      path,
      data,
      directory: Directory.Cache,
      recursive: true,
    });
    const uri = fileUriForShare(written.uri);
    if (uri) return uri;
    const located = await Filesystem.getUri({ directory: Directory.Cache, path });
    return fileUriForShare(located.uri);
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read share image"));
    reader.readAsDataURL(blob);
  });
}
