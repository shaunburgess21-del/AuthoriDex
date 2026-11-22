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
 *    JSON-LD into the Vite shell for vote / matchup / predict detail URLs.
 *    The shell is otherwise identical for every route, so Google and a plain
 *    curl see the homepage card. Link-preview rewrites in vercel.json stay
 *    as the fallback when this fetch fails.
 *
 * Country-restricted world markets already resolve to a generic title in
 * the OG payload. Vote cards unfurl on a direct link; the page does too.
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
    const meta = await loadDocumentMeta(url.pathname);
    if (!meta?.title || !meta.canonicalUrl) return next();
    const indexRes = await fetch(new URL("/index.html", url.origin), {
      headers: { accept: "text/html", "x-og-shell": "1" },
    });
    if (!indexRes.ok) return next();
    const html = injectOgDocument(await indexRes.text(), meta);
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

async function loadDocumentMeta(pathname: string): Promise<OgDocumentMeta | null> {
  const cached = await readMetaCache(pathname);
  if (cached) return cached;

  const fromJson = await fetchJsonMeta(pathname);
  if (fromJson) {
    await writeMetaCache(pathname, fromJson);
    return fromJson;
  }

  const htmlPath = ogHtmlPathForSpaPath(pathname);
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
    await writeMetaCache(pathname, parsed);
    return parsed;
  } catch (err) {
    console.error(`[og-document] html fetch failed ${htmlPath}`, err);
    return null;
  }
}

/** New JSON route. A 404 is expected until Railway deploys it; don't let that eat the HTML fallback's time. */
async function fetchJsonMeta(pathname: string): Promise<OgDocumentMeta | null> {
  const jsonUrl = `${OG_ORIGIN}/api/og/document-meta?path=${encodeURIComponent(pathname)}`;
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

function metaCacheRequest(pathname: string): Request {
  return new Request(`https://voxdex-og-document.internal${pathname}`);
}

async function readMetaCache(pathname: string): Promise<OgDocumentMeta | null> {
  try {
    const cache = await caches.open("voxdex-og-document");
    const hit = await cache.match(metaCacheRequest(pathname));
    if (!hit) return null;
    const body = (await hit.json()) as OgDocumentMeta;
    if (!body?.title || !body.canonicalUrl) return null;
    return body;
  } catch {
    return null;
  }
}

async function writeMetaCache(pathname: string, meta: OgDocumentMeta): Promise<void> {
  try {
    const cache = await caches.open("voxdex-og-document");
    await cache.put(
      metaCacheRequest(pathname),
      new Response(JSON.stringify(meta), {
        headers: { "cache-control": `public, max-age=${META_TTL_SECONDS}` },
      }),
    );
  } catch {
    /* edge cache is an optimization */
  }
}
