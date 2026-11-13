import { Capacitor } from "@capacitor/core";

/**
 * Public origin already used by web/PWA share links and by Android App
 * Links. Capacitor Android serves the bundle from `https://localhost`
 * (`androidScheme: "https"`). iOS keeps Capacitor's default
 * `capacitor://localhost` (there is no `iosScheme` override). Share URLs
 * built from `window.location.origin` must be rewritten before they leave
 * either shell.
 */
export const PUBLIC_SHARE_ORIGIN = "https://voxdex.com";

/**
 * Directory under Capacitor `Directory.Cache` for share PNGs.
 * `res/xml/file_paths.xml` `<cache-path path>` must stay equal to this.
 * Phase 14 removed the template external-storage FileProvider root.
 */
export const ANDROID_SHARE_CACHE_DIR = "share";

const WEBVIEW_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
]);

const WEBVIEW_ORIGIN_IN_TEXT =
  /(?:https?:\/\/localhost|capacitor:\/\/localhost)(?=\/|\?|#|$)/g;

export interface ShareUrlContext {
  /** Android shell. Also selects the system share sheet and cache PNG path. */
  nativeAndroid: boolean;
  /**
   * iOS shell. Rewrites webview share URLs. URL, text, and image shares
   * use the Capacitor share sheet. Image bytes are a file in the cache
   * directory. Leave this false on Android.
   */
  nativeIos: boolean;
  currentOrigin: string;
}

/**
 * Android and iOS use the Capacitor share sheet. Image shares write the
 * PNG into `Directory.Cache` first, because the plugin takes a file URI
 * and its web implementation drops file payloads. The website stays on
 * `navigator.share`.
 */
export function isAndroidNativeShare(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function isIosNativeShare(): boolean {
  return isIosNativeWebView();
}

function isIosNativeWebView(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

export function currentShareContext(): ShareUrlContext {
  return {
    nativeAndroid: isAndroidNativeShare(),
    nativeIos: isIosNativeWebView(),
    currentOrigin: typeof window !== "undefined" ? window.location.origin : "",
  };
}

function leavesNativeWebView(ctx: ShareUrlContext): boolean {
  return ctx.nativeAndroid || ctx.nativeIos;
}

/**
 * Origin used when building a share/referral link. The website keeps
 * `window.location.origin`. Android (`https://localhost`) and iOS
 * (`capacitor://localhost`) webview origins become the public host.
 * `nativeWebView` is true for either shell.
 */
export function shareLinkOrigin(currentOrigin: string, nativeWebView: boolean): string {
  if (nativeWebView && WEBVIEW_ORIGINS.has(currentOrigin)) return PUBLIC_SHARE_ORIGIN;
  return currentOrigin;
}

export function outboundShareOrigin(currentOrigin: string): string {
  return shareLinkOrigin(currentOrigin, isAndroidNativeShare() || isIosNativeWebView());
}

/**
 * Rewrite a WebView-origin share URL to `https://voxdex.com`, preserving
 * path, query (`ref`, `sharer`, `utm_*`), and hash. No-op on the website,
 * and when the URL is already public or points at any other host.
 * Android and iOS both rewrite, then open the Capacitor share sheet.
 */
export function toPublicShareUrl(url: string, ctx: ShareUrlContext): string {
  if (!leavesNativeWebView(ctx)) return url;
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
 * explicitly. Android's configured scheme is `https://localhost`. iOS
 * keeps the default `capacitor://localhost`.
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
  if (!leavesNativeWebView(ctx) || !text) return text;
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

/**
 * Which native sheet a payload should use. Image files are included:
 * both shells receive a cache-file URI. The website is "none" and keeps
 * `navigator.share`.
 */
export function systemShareTarget(
  nativeAndroid: boolean,
  nativeIos: boolean,
  _hasFiles: boolean,
): "android" | "ios" | "none" {
  if (nativeAndroid) return "android";
  if (nativeIos) return "ios";
  return "none";
}

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

/**
 * URL, text, and image shares. Android keeps the file-capable sheet.
 * iOS opens `@capacitor/share` the same way, including cache-file URIs.
 * The website returns "unavailable" so callers fall through to Web Share
 * or the clipboard.
 */
export async function shareWithSystemSheet(options: {
  title?: string;
  text?: string;
  url?: string;
  files?: string[];
}): Promise<SheetShareOutcome> {
  let nativeAndroid = false;
  let nativeIos = false;
  try {
    nativeAndroid = isAndroidNativeShare();
    nativeIos = isIosNativeWebView();
  } catch {
    return "unavailable";
  }
  const target = systemShareTarget(nativeAndroid, nativeIos, (options.files?.length ?? 0) > 0);
  if (target === "android") return shareWithAndroidSheet(options);
  if (target !== "ios") return "unavailable";

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

async function writeSharePng(blob: Blob, filename: string): Promise<string | null> {
  try {
    const { Directory, Filesystem } = await import("@capacitor/filesystem");
    const data = await blobToBase64(blob);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "voxdex-share.png";
    const path = `${ANDROID_SHARE_CACHE_DIR}/${Date.now()}-${safeName}`;
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

/** Android FileProvider cache path. iOS does not use this entry point. */
export async function cachePngForAndroidShare(blob: Blob, filename: string): Promise<string | null> {
  if (!isAndroidNativeShare()) return null;
  return writeSharePng(blob, filename);
}

/**
 * Cache PNG for either native shell. `@capacitor/share` needs a `file:`
 * URI. Web returns null and keeps `navigator.share({ files })`.
 */
export async function cachePngForNativeShare(blob: Blob, filename: string): Promise<string | null> {
  let native = false;
  try {
    native = isAndroidNativeShare() || isIosNativeWebView();
  } catch {
    return null;
  }
  if (!native) return null;
  return writeSharePng(blob, filename);
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
