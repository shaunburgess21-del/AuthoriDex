import { useEffect } from "react";

interface DocumentMetaOptions {
  title: string;
  description?: string | null;
  /** Optional fully-qualified image URL for the OG / Twitter preview. */
  image?: string | null;
  /** Optional canonical URL override; defaults to current href. */
  url?: string | null;
}

const META_DEFINITIONS: ReadonlyArray<{
  selector: string;
  attr: "name" | "property";
  key: string;
  source: keyof DocumentMetaOptions;
}> = [
  { selector: 'meta[name="description"]', attr: "name", key: "description", source: "description" },
  { selector: 'meta[property="og:title"]', attr: "property", key: "og:title", source: "title" },
  { selector: 'meta[property="og:description"]', attr: "property", key: "og:description", source: "description" },
  { selector: 'meta[property="og:image"]', attr: "property", key: "og:image", source: "image" },
  { selector: 'meta[property="og:url"]', attr: "property", key: "og:url", source: "url" },
  { selector: 'meta[name="twitter:title"]', attr: "name", key: "twitter:title", source: "title" },
  { selector: 'meta[name="twitter:description"]', attr: "name", key: "twitter:description", source: "description" },
  { selector: 'meta[name="twitter:image"]', attr: "name", key: "twitter:image", source: "image" },
];

function ensureMeta(selector: string, attr: "name" | "property", key: string): HTMLMetaElement {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Open Graph + Twitter Cards specs both require image / url meta tags
 * to be absolute. Browsers don't enforce this — `<meta og:image>` with
 * a relative URL still renders fine when a human opens the tab — but
 * non-browser scrapers (Twitter's card renderer, Google's second-pass
 * indexer, Embedly, iframely) skip relative URLs silently and the
 * preview falls back to nothing.
 *
 * We accept relative paths from callers (so a page can write
 * `/api/og/image/...` without thinking about origin in dev/preview
 * environments) and promote them to absolute against the live origin
 * before pinning them into the head.
 */
function toAbsoluteUrl(value: string): string {
  if (typeof window === "undefined") return value;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return value;
  }
}

const ABSOLUTE_URL_KEYS: ReadonlySet<keyof DocumentMetaOptions> = new Set([
  "image",
  "url",
]);

/**
 * Update the document `<title>`, description, and OG / Twitter preview
 * tags from inside a React page component.
 *
 * Why we keep this on the client even though Slack / iMessage don't run JS:
 *   - Browser tabs need the right title (the static `<title>` from
 *     `index.html` is fine on the home page but useless on a market
 *     detail page).
 *   - Modern crawlers that DO run JS (Google, Bing, Twitter's renderer
 *     on second pass) pick up the dynamic tags as a fallback if the
 *     bot-UA Vercel rewrite (see `vercel.json`) ever fails to fire.
 *   - Browser back/forward + sharing the URL via Cmd-C captures the
 *     correct title in macOS / iOS share sheets, which DO read the
 *     live document title rather than refetching.
 *
 * On unmount we restore the previous title so navigating away from a
 * detail page back to a generic page doesn't leave a stale "Jeff Bezos:
 * Up or Down? • VoxDex" tab title behind.
 */
export function useDocumentMeta(opts: DocumentMetaOptions): void {
  const { title, description, image, url } = opts;

  useEffect(() => {
    if (typeof document === "undefined") return;

    const previousTitle = document.title;
    const previousValues = new Map<string, string | null>();

    document.title = title;

    const resolved: Record<keyof DocumentMetaOptions, string | undefined | null> = {
      title,
      description,
      image,
      url: url ?? (typeof window !== "undefined" ? window.location.href : null),
    };

    for (const def of META_DEFINITIONS) {
      const raw = resolved[def.source];
      if (!raw) continue;
      const value = ABSOLUTE_URL_KEYS.has(def.source) ? toAbsoluteUrl(raw) : raw;
      const el = ensureMeta(def.selector, def.attr, def.key);
      previousValues.set(def.selector, el.getAttribute("content"));
      el.setAttribute("content", value);
    }

    return () => {
      document.title = previousTitle;
      for (const def of META_DEFINITIONS) {
        const el = document.head.querySelector<HTMLMetaElement>(def.selector);
        if (!el) continue;
        const prev = previousValues.get(def.selector);
        if (prev === undefined || prev === null) {
          // We created it on enter — remove it so the document goes back
          // to the index.html baseline rather than carrying detail-page
          // copy onto the next route.
          if (!previousValues.has(def.selector)) continue;
          el.removeAttribute("content");
        } else {
          el.setAttribute("content", prev);
        }
      }
    };
  }, [title, description, image, url]);
}
