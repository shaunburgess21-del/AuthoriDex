/**
 * Per-page document meta for the Vite shell.
 *
 * Vercel serves one index.html for every route. Link-preview bots that match
 * vercel.json see a dedicated OG document; everyone else (including Google
 * and a plain curl) used to see the homepage title. These helpers inject the
 * page's own tags into that shell. They stay free of Node and database
 * imports so Edge Middleware can use them.
 */

export interface OgDocumentMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  imageType?: string;
  jsonLd?: Record<string, unknown>;
}

const DETAIL_PATTERNS: RegExp[] = [
  /^\/vote\/matchups\/[^/]+\/?$/,
  /^\/vote\/opinion-polls\/[^/]+\/?$/,
  /^\/polls\/[^/]+\/?$/,
  /^\/predict\/updown\/[^/]+\/?$/,
  /^\/predict\/h2h\/[^/]+\/?$/,
  /^\/predict\/race\/[^/]+\/?$/,
  /^\/markets\/[^/]+\/?$/,
  /^\/(?:person|celebrity)\/[^/]+\/?$/,
  /^\/share\/bet\/[^/]+\/?$/,
  /^\/insights\/?$/,
  /^\/explore\/?$/,
];

/** True for a shareable detail URL. Home, /vote, and /predict stay generic. */
export function isOgDetailPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (!path || path.includes(".")) return false;
  return DETAIL_PATTERNS.some((re) => re.test(path));
}

/**
 * Railway HTML endpoint that already renders this path for link-preview bots.
 * Used when the JSON meta route is not deployed yet.
 */
export function ogHtmlPathForSpaPath(pathname: string): string | null {
  const path = normalizePathname(pathname);
  const rules: Array<[RegExp, (slug: string) => string]> = [
    [/^\/vote\/matchups\/([^/]+)\/?$/, (slug) => `/api/og/matchups/${encodeURIComponent(slug)}`],
    [/^\/vote\/opinion-polls\/([^/]+)\/?$/, (slug) => `/api/og/opinion-polls/${encodeURIComponent(slug)}`],
    [/^\/polls\/([^/]+)\/?$/, (slug) => `/api/og/polls/${encodeURIComponent(slug)}`],
    [/^\/predict\/updown\/([^/]+)\/?$/, (slug) => `/api/og/predict/updown/${encodeURIComponent(slug)}`],
    [/^\/predict\/h2h\/([^/]+)\/?$/, (slug) => `/api/og/predict/h2h/${encodeURIComponent(slug)}`],
    [/^\/predict\/race\/([^/]+)\/?$/, (slug) => `/api/og/predict/race/${encodeURIComponent(slug)}`],
    [/^\/markets\/([^/]+)\/?$/, (slug) => `/api/og/markets/${encodeURIComponent(slug)}`],
    [/^\/(?:person|celebrity)\/([^/]+)\/?$/, (id) => `/api/og/person/${encodeURIComponent(id)}`],
    [/^\/share\/bet\/([^/]+)\/?$/, (id) => `/api/og/share/bet/${encodeURIComponent(id)}`],
    [/^\/insights\/?$/, () => `/api/og/insights?path=${encodeURIComponent("/insights")}`],
    [/^\/explore\/?$/, () => `/api/og/insights?path=${encodeURIComponent("/explore")}`],
  ];
  for (const [re, build] of rules) {
    const match = path.match(re);
    if (match) return build(match[1] ?? "");
  }
  return null;
}

export function buildOgJsonLd(meta: {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
}): Record<string, unknown> {
  let publisherUrl = "https://voxdex.com";
  try {
    publisherUrl = new URL(meta.canonicalUrl).origin;
  } catch {
    /* keep default */
  }
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: meta.title,
    description: meta.description,
    url: meta.canonicalUrl,
    isPartOf: {
      "@type": "WebSite",
      name: "VoxDex",
      url: publisherUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "VoxDex",
      url: publisherUrl,
    },
  };
  if (meta.imageUrl) {
    data.image = meta.imageUrl;
    data.primaryImageOfPage = {
      "@type": "ImageObject",
      url: meta.imageUrl,
      width: 1200,
      height: 630,
    };
  }
  return data;
}

export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function ogJsonLdScript(meta: {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  jsonLd?: Record<string, unknown>;
}): string {
  const jsonLd = meta.jsonLd ?? buildOgJsonLd(meta);
  return `<script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>`;
}

/** Pull title, description, canonical, and image out of an OG HTML document. */
export function parseOgDocumentHtml(html: string): OgDocumentMeta | null {
  const title = decodeHtml(readTag(html, /<title>([^<]*)<\/title>/i));
  const description =
    decodeHtml(readMeta(html, "name", "description")) ||
    decodeHtml(readMeta(html, "property", "og:description"));
  const canonical =
    decodeHtml(readTag(html, /<link rel="canonical" href="([^"]+)"/i)) ||
    decodeHtml(readMeta(html, "property", "og:url"));
  if (!title || !canonical) return null;
  const imageUrl = decodeHtml(readMeta(html, "property", "og:image")) || undefined;
  const imageType = decodeHtml(readMeta(html, "property", "og:image:type")) || undefined;
  const meta: OgDocumentMeta = {
    title,
    description: description || title,
    canonicalUrl: canonical,
    imageUrl,
    imageType,
  };
  meta.jsonLd = buildOgJsonLd(meta);
  return meta;
}

/**
 * Rewrite the homepage tags in the Vite shell. Leaves asset tags, theme
 * boot script, and fonts alone. Omits og:image when the payload has none
 * so a country-restricted card keeps the generic site image instead of
 * publishing its own artwork.
 */
export function injectOgDocument(html: string, meta: OgDocumentMeta): string {
  let out = html;
  out = replaceOnce(out, /<title>[^<]*<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`);
  out = setMeta(out, "name", "description", meta.description);
  out = setMeta(out, "property", "og:title", meta.title);
  out = setMeta(out, "property", "og:description", meta.description);
  out = setMeta(out, "property", "og:url", meta.canonicalUrl);
  out = setMeta(out, "name", "twitter:title", meta.title);
  out = setMeta(out, "name", "twitter:description", meta.description);
  out = replaceOnce(
    out,
    /<link rel="canonical" href="[^"]*"\s*\/?>/i,
    `<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`,
  );

  if (meta.imageUrl) {
    out = setMeta(out, "property", "og:image", meta.imageUrl);
    out = setMeta(out, "name", "twitter:image", meta.imageUrl);
    out = setMeta(out, "name", "twitter:card", "summary_large_image");
    if (meta.imageType) {
      out = setMeta(out, "property", "og:image:type", meta.imageType);
    }
    if (meta.imageUrl.startsWith("https://")) {
      out = setMeta(out, "property", "og:image:secure_url", meta.imageUrl);
    }
  }

  if (!out.includes('type="application/ld+json"')) {
    out = out.replace("</head>", `    ${ogJsonLdScript(meta)}\n  </head>`);
  }
  return out;
}

function normalizePathname(pathname: string): string {
  const raw = pathname.trim();
  if (!raw) return "/";
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return new URL(raw).pathname || "/";
    }
  } catch {
    /* use the raw path */
  }
  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return path.split("?")[0]?.split("#")[0] || "/";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtml(value: string | null): string {
  if (!value) return "";
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readTag(html: string, re: RegExp): string | null {
  const match = html.match(re);
  return match?.[1] ?? null;
}

function readMeta(html: string, attr: "name" | "property", key: string): string | null {
  const re = new RegExp(
    `<meta ${attr}="${escapeRegExp(key)}" content="([^"]*)"\\s*/?>`,
    "i",
  );
  return html.match(re)?.[1] ?? null;
}

function setMeta(html: string, attr: "name" | "property", key: string, content: string): string {
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(content)}" />`;
  const re = new RegExp(
    `<meta ${attr}="${escapeRegExp(key)}" content="[^"]*"\\s*/?>`,
    "i",
  );
  if (re.test(html)) return html.replace(re, () => tag);
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

function replaceOnce(html: string, re: RegExp, replacement: string): string {
  if (!re.test(html)) return html;
  return html.replace(re, () => replacement);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
