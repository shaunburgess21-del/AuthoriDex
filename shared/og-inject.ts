/**
 * Edge injection of per-page document meta into the Vite shell.
 *
 * Browsers get a hard budget so a slow Railway meta fetch cannot stall
 * first paint. Link-preview bots and search crawlers keep a longer budget:
 * Google is not in the matchup/predict rewrites, so it still needs this
 * injection, and link-preview bots fall through to the vercel.json Railway
 * rewrite when injection does not finish.
 *
 * The injected document is the static shell plus public title, description,
 * canonical, Open Graph, Twitter, and JSON-LD. Nothing from the cookie,
 * Authorization header, or `?ref=` code is written into it.
 */

import {
  injectOgDocument,
  isOgDetailPath,
  ogDocumentMetaCacheKey,
  ogHtmlPathForSpaPath,
  parseOgDocumentHtml,
  type OgDocumentMeta,
} from "./og-document";

/**
 * Browser ceiling for the Railway JSON meta fetch and, only when that
 * returns quickly, the HTML fallback. The shell fetch is separate so a
 * meta response that lands just under this budget can still be injected.
 */
export const BROWSER_BUDGET_MS = 1_200;
/** Crawler JSON attempt. A miss still leaves room for the HTML fallback. */
export const JSON_TIMEOUT_MS = 900;
/** Crawler HTML fallback when the JSON route misses or is not deployed. */
export const HTML_TIMEOUT_MS = 4_000;
/** Hang cap for the same-origin /index.html fetch. A miss falls through. */
export const SHELL_TIMEOUT_MS = 1_000;
/** Crawlers keep the previous JSON + HTML windows. The shell cap is extra. */
export const CRAWLER_BUDGET_MS = JSON_TIMEOUT_MS + HTML_TIMEOUT_MS;

/**
 * Shared CDN cache. The body is identical for every viewer of a URL.
 * max-age=0 keeps browsers revalidating; s-maxage is the CDN TTL.
 */
export const INJECTED_HTML_CACHE_CONTROL =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=300";
export const INJECTED_HTML_CDN_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

const LINK_PREVIEW_UA =
  /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|pinterest|redditbot|embedly|quora link preview|iframely|mastodon|nuzzel|vkshare|tumblr/i;

const SEARCH_CRAWLER_UA =
  /googlebot|google-inspectiontool|adsbot-google|mediapartners-google|bingbot|duckduckbot|applebot|baiduspider|yandexbot|slurp|ia_archiver/i;

export type OgFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OgInjectDeps {
  fetch: OgFetch;
  now: () => number;
  readCache: (cacheKey: string) => Promise<OgDocumentMeta | null>;
  writeCache: (cacheKey: string, meta: OgDocumentMeta) => Promise<void>;
  passThrough: () => Response | Promise<Response>;
  origin: string;
  /** Test override for the whole JSON + HTML + shell budget. */
  budgetMs?: number;
  shellTimeoutMs?: number;
}

export function isOgCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return LINK_PREVIEW_UA.test(userAgent) || SEARCH_CRAWLER_UA.test(userAgent);
}

export function upstreamBudgetMs(userAgent: string | null | undefined): number {
  return isOgCrawlerUserAgent(userAgent) ? CRAWLER_BUDGET_MS : BROWSER_BUDGET_MS;
}

export function resolveUpstreamBudget(
  userAgent: string | null | undefined,
  override?: number,
): number {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) return override;
  return upstreamBudgetMs(userAgent);
}

/**
 * How long this attempt may run. Crawlers keep the historical per-hop caps.
 * Browsers may spend the whole remaining budget on JSON before falling
 * through, instead of timing JSON out at 900ms and then waiting on HTML.
 */
export function attemptTimeoutMs(args: {
  phase: "json" | "html" | "shell";
  timeLeftMs: number;
  crawler: boolean;
  shellTimeoutMs?: number;
}): number {
  const timeLeft = Math.max(0, args.timeLeftMs);
  if (timeLeft <= 0) return 0;
  if (args.phase === "shell") {
    return Math.min(timeLeft, args.shellTimeoutMs ?? SHELL_TIMEOUT_MS);
  }
  if (!args.crawler) return timeLeft;
  const cap = args.phase === "json" ? JSON_TIMEOUT_MS : HTML_TIMEOUT_MS;
  return Math.min(timeLeft, cap);
}

export async function handleOgDocument(request: Request, deps: OgInjectDeps): Promise<Response> {
  if (request.headers.get("x-og-shell") === "1") return deps.passThrough();
  const url = new URL(request.url);
  if (!isOgDetailPath(url.pathname)) return deps.passThrough();
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return deps.passThrough();

  try {
    const userAgent = request.headers.get("user-agent");
    const crawler = isOgCrawlerUserAgent(userAgent);
    const budget = resolveUpstreamBudget(userAgent, deps.budgetMs);
    const started = deps.now();
    const timeLeft = () => Math.max(0, budget - (deps.now() - started));
    const meta = await loadDocumentMeta(url, deps, () => timeLeft(), crawler);
    if (!meta?.title || !meta.canonicalUrl) return deps.passThrough();

    // Shell is outside the Railway budget: meta that arrives in time still
    // gets injected, and a hung /index.html cannot stall the navigation.
    const shellTimeout = attemptTimeoutMs({
      phase: "shell",
      timeLeftMs: Number.POSITIVE_INFINITY,
      crawler,
      shellTimeoutMs: deps.shellTimeoutMs,
    });
    if (shellTimeout <= 0) return deps.passThrough();

    const shellHeaders = new Headers();
    shellHeaders.set("accept", "text/html");
    shellHeaders.set("x-og-shell", "1");
    // Protected previews reject a bare fetch of /index.html and return the
    // Vercel login document. Forward the caller's bypass cookie so the shell
    // is the real app, then refuse to rewrite anything that is not that shell.
    const cookie = request.headers.get("cookie");
    const bypass = request.headers.get("x-vercel-protection-bypass");
    if (cookie) shellHeaders.set("cookie", cookie);
    if (bypass) shellHeaders.set("x-vercel-protection-bypass", bypass);

    const shellResult = await fetchText(
      deps.fetch,
      new URL("/index.html", url.origin).href,
      shellTimeout,
      { headers: shellHeaders },
    );
    if (!shellResult || shellResult.status < 200 || shellResult.status >= 300) {
      return deps.passThrough();
    }
    if (!shellResult.text.includes('id="root"')) {
      console.error("[og-document] shell fetch was not the app document");
      return deps.passThrough();
    }
    const html = injectOgDocument(shellResult.text, meta);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": INJECTED_HTML_CACHE_CONTROL,
        "cdn-cache-control": INJECTED_HTML_CDN_CACHE_CONTROL,
        "vercel-cdn-cache-control": INJECTED_HTML_CDN_CACHE_CONTROL,
        "x-og-document": "1",
      },
    });
  } catch (err) {
    console.error("[og-document] inject failed", err);
    return deps.passThrough();
  }
}

async function loadDocumentMeta(
  url: URL,
  deps: OgInjectDeps,
  timeLeft: () => number,
  crawler: boolean,
): Promise<OgDocumentMeta | null> {
  const pathWithSearch = `${url.pathname}${url.search}`;
  const cacheKey = ogDocumentMetaCacheKey(pathWithSearch);
  let cached: OgDocumentMeta | null = null;
  try {
    cached = await deps.readCache(cacheKey);
  } catch {
    cached = null;
  }
  if (cached?.title && cached.canonicalUrl) return cached;

  const fromJson = await fetchJsonMeta(deps, pathWithSearch, timeLeft(), crawler);
  if (fromJson) {
    await storeMeta(deps, cacheKey, fromJson);
    return fromJson;
  }

  const htmlTimeout = attemptTimeoutMs({
    phase: "html",
    timeLeftMs: timeLeft(),
    crawler,
  });
  if (htmlTimeout <= 0) return null;

  const htmlPath = ogHtmlPathForSpaPath(url.pathname);
  if (!htmlPath) return null;
  const htmlResult = await fetchText(
    deps.fetch,
    `${deps.origin}${htmlPath}`,
    htmlTimeout,
    { headers: { accept: "text/html" } },
  );
  if (!htmlResult) return null;
  if (htmlResult.status < 200 || htmlResult.status >= 300) {
    console.error(`[og-document] html ${htmlResult.status} ${htmlPath}`);
    return null;
  }
  const parsed = parseOgDocumentHtml(htmlResult.text);
  if (!parsed) {
    console.error(`[og-document] html parse failed ${htmlPath}`);
    return null;
  }
  await storeMeta(deps, cacheKey, parsed);
  return parsed;
}

async function fetchJsonMeta(
  deps: OgInjectDeps,
  pathWithSearch: string,
  timeLeftMs: number,
  crawler: boolean,
): Promise<OgDocumentMeta | null> {
  const timeoutMs = attemptTimeoutMs({ phase: "json", timeLeftMs, crawler });
  if (timeoutMs <= 0) return null;
  const jsonUrl = `${deps.origin}/api/og/document-meta?path=${encodeURIComponent(pathWithSearch)}`;
  const result = await fetchText(deps.fetch, jsonUrl, timeoutMs, {
    headers: { accept: "application/json" },
  });
  if (!result || result.status < 200 || result.status >= 300 || !result.text) return null;
  try {
    const body = JSON.parse(result.text) as OgDocumentMeta;
    if (!body?.title || !body.canonicalUrl) return null;
    return body;
  } catch {
    return null;
  }
}

async function storeMeta(deps: OgInjectDeps, cacheKey: string, meta: OgDocumentMeta): Promise<void> {
  try {
    await deps.writeCache(cacheKey, meta);
  } catch {
    /* edge cache is an optimization */
  }
}

async function fetchText(
  fetcher: OgFetch,
  url: string,
  timeoutMs: number,
  init: RequestInit,
): Promise<{ status: number; text: string } | null> {
  if (timeoutMs <= 0) return null;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, text: "" };
    }
    const text = await readBody(response, signal);
    return { status: response.status, text };
  } catch {
    return null;
  }
}

function readBody(response: Response, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      void response.body?.cancel().catch(() => undefined);
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    response.text().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

function abortReason(signal: AbortSignal): unknown {
  const reason = signal.reason;
  if (reason) return reason;
  return new DOMException("The operation was aborted.", "AbortError");
}
