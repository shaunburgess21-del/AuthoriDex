import { geolocation, next } from "@vercel/functions";
import { countryHeadersFromEdge } from "./shared/viewerCountry";

/**
 * `/api/*` is not a Vercel function. vercel.json rewrites it to the Railway
 * Express origin. Vercel documents forwarding x-real-ip and x-forwarded-*
 * on that hop, not x-vercel-ip-country (that header is for Middleware and
 * Functions). This copies the edge country onto the request Vercel then
 * proxies, and clears a client-supplied value when the edge has none.
 *
 * Express reads x-vercel-ip-country, then x-voxdex-country, then cf-ipcountry.
 */
export const config = {
  matcher: "/api/:path*",
};

export default function middleware(request: Request) {
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
