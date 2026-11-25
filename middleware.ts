import { geolocation, next } from "@vercel/functions";
import { countryHeadersFromEdge } from "./shared/viewerCountry";
import {
  injectOgDocument,
  isOgDetailPath,
  ogHtmlPathForSpaPath,
  parseOgDocumentHtml,
  type OgDocumentMeta,
} from "./shared/og-document";

/**
 * Two jobs:
 * 1. Stamp the edge country onto `/api/*` before Vercel proxies to Railway.
 *    Express reads x-vercel-ip-country, then x-voxdex-country, then cf-ipcountry.
 * 2. Inject per-page title, description, canonical, Open Graph, Twitter, and
 *    JSON-LD into the Vite shell for shareable detail URLs (matchups, polls,
 *    predict markets, celebrity profiles, and the other pages that already
 *    have a Railway OG document). The shell is otherwise identical for every
 *    route, so Google and a plain curl see the homepage card. Link-preview
 *    rewrites in vercel.json stay as the fallback when this fetch fails.
 *
 * Country-restricted world markets already resolve to a generic title in
 * the OG payload. The homepage, /vote, and /predict keep the generic card.
 */

const OG_ORIGIN =
  process.env.OG_HTML_ORIGIN?.replace(/\/$/, "") ||
  "https://authoridex-production.up.railway.app";

const META_TTL_SECONDS = 120;
const JSON_TIMEOUT_MS = 900;
const HTML_TIMEOUT_MS = 4000;

export const config = {
  matcher: [
    "/api/:path*",
    "/vote/matchups/:slug",
    "/vote/opinion-polls/:slug",
    "/polls/:slug",
    "/predict/updown/:marketId",
    "/predict/h2h/:marketId",
    "/predict/race/:marketId",
    "/markets/:slug",
    "/person/:id",
    "/celebrity/:id",
    "/share/bet/:betId",
    "/insights",
    "/explore",
  ],
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  // The shell fetch below sets this so a re-entry cannot loop.
  if (request.headers.get("x-og-shell") === "1") {
    return next();
  }
  if (url.pathname.startsWith("/api/")) {
    return stampCountry(request);
  }
  if (!isOgDetailPath(url.pathname)) {
    return next();
  }
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") {
    return next();
  }

  try {
    const meta = await loadDocumentMeta(url);
    if (!meta?.title || !meta.canonicalUrl) return next();
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
    const indexRes = await fetch(new URL("/index.html", url.origin), {
      headers: shellHeaders,
    });
    if (!indexRes.ok) return next();
    const shell = await indexRes.text();
    if (!shell.includes('id="root"')) {
      console.error("[og-document] shell fetch was not the app document");
      return next();
    }
    const html = injectOgDocument(shell, meta);
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, no-store, must-revalidate",
        "x-og-document": "1",
      },
    });
  } catch (err) {
    console.error("[og-document] inject failed", err);
    return next();
  }
}

function stampCountry(request: Request) {
  const requestHeaders = new Headers(request.headers);
  const edgeCountry =
    geolocation(request).country ?? request.headers.get("x-vercel-ip-country");
  const stamped = countryHeadersFromEdge(edgeCountry);
  requestHeaders.set("x-vercel-ip-country", stamped?.["x-vercel-ip-country"] ?? "");
  requestHeaders.set("x-voxdex-country", stamped?.["x-voxdex-country"] ?? "");
  return next({
    request: { headers: requestHeaders },
  });
}

async function loadDocumentMeta(url: URL): Promise<OgDocumentMeta | null> {
  const cacheKey = `${url.pathname}${url.search}`;
  const cached = await readMetaCache(cacheKey);
  if (cached) return cached;

  const fromJson = await fetchJsonMeta(cacheKey);
  if (fromJson) {
    await writeMetaCache(cacheKey, fromJson);
    return fromJson;
  }

  const htmlPath = ogHtmlPathForSpaPath(url.pathname);
  if (!htmlPath) return null;
  try {
    const htmlRes = await fetch(`${OG_ORIGIN}${htmlPath}`, {
      signal: AbortSignal.timeout(HTML_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
    if (!htmlRes.ok) {
      console.error(`[og-document] html ${htmlRes.status} ${htmlPath}`);
      return null;
    }
    const parsed = parseOgDocumentHtml(await htmlRes.text());
    if (!parsed) {
      console.error(`[og-document] html parse failed ${htmlPath}`);
      return null;
    }
    await writeMetaCache(cacheKey, parsed);
    return parsed;
  } catch (err) {
    console.error(`[og-document] html fetch failed ${htmlPath}`, err);
    return null;
  }
}

/** JSON route on Railway. A 404 is expected until that route is deployed. */
async function fetchJsonMeta(pathWithSearch: string): Promise<OgDocumentMeta | null> {
  const jsonUrl = `${OG_ORIGIN}/api/og/document-meta?path=${encodeURIComponent(pathWithSearch)}`;
  try {
    const jsonRes = await fetch(jsonUrl, {
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!jsonRes.ok) {
      await jsonRes.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = (await jsonRes.json()) as OgDocumentMeta;
    if (!body?.title || !body.canonicalUrl) return null;
    return body;
  } catch {
    return null;
  }
}

function metaCacheRequest(cacheKey: string): Request {
  return new Request(`https://voxdex-og-document.internal${cacheKey}`);
}

async function readMetaCache(cacheKey: string): Promise<OgDocumentMeta | null> {
  try {
    const cache = await caches.open("voxdex-og-document");
    const hit = await cache.match(metaCacheRequest(cacheKey));
    if (!hit) return null;
    const body = (await hit.json()) as OgDocumentMeta;
    if (!body?.title || !body.canonicalUrl) return null;
    return body;
  } catch {
    return null;
  }
}

async function writeMetaCache(cacheKey: string, meta: OgDocumentMeta): Promise<void> {
  try {
    const cache = await caches.open("voxdex-og-document");
    await cache.put(
      metaCacheRequest(cacheKey),
      new Response(JSON.stringify(meta), {
        headers: { "cache-control": `public, max-age=${META_TTL_SECONDS}` },
      }),
    );
  } catch {
    /* edge cache is an optimization */
  }
}
