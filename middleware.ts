import { geolocation, next } from "@vercel/functions";
import { countryHeadersFromEdge } from "./shared/viewerCountry";
import type { OgDocumentMeta } from "./shared/og-document";
import { handleOgDocument } from "./shared/og-inject";

/**
 * Two jobs:
 * 1. Stamp the edge country onto `/api/*` before Vercel proxies to Railway.
 *    Express reads x-vercel-ip-country, then x-voxdex-country, then cf-ipcountry.
 * 2. Inject per-page title, description, canonical, Open Graph, Twitter, and
 *    JSON-LD into the Vite shell for shareable detail URLs. Browsers spend at
 *    most ~1.2s on Railway meta and otherwise get the plain shell. The shell
 *    fetch itself has a timeout. Crawlers and link-preview bots keep a longer
 *    fetch, and a bot that still misses falls through to the Railway rewrite
 *    in vercel.json.
 *
 * The injected HTML is the same for every viewer. Country-restricted markets
 * already resolve to one generic card, and `?ref=` is read from the URL by
 * the client after load.
 */

const OG_ORIGIN =
  process.env.OG_HTML_ORIGIN?.replace(/\/$/, "") ||
  "https://authoridex-production.up.railway.app";

const META_TTL_SECONDS = 120;

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
  return handleOgDocument(request, {
    fetch,
    now: () => Date.now(),
    readCache: readMetaCache,
    writeCache: writeMetaCache,
    passThrough: () => next(),
    origin: OG_ORIGIN,
  });
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
