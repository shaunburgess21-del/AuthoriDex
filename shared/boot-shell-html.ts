/**
 * Turn Vite's render-blocking app stylesheets into preload + onload.
 *
 * The entry CSS is large enough to hold first paint for seconds on a
 * slow link. Preload does not block painting, so the inline #boot-shell
 * rules in <head> can paint with the HTML. <noscript> keeps the sheet
 * for crawlers and no-JS clients. Fonts and anything already inside
 * <noscript> are left alone.
 */
export function makeAppStylesheetsNonBlocking(html: string): string {
  return html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>|<link\b[^>]*>/gi, (token) => {
    if (/^<noscript\b/i.test(token)) return token;
    if (!/\brel\s*=\s*"stylesheet"/i.test(token)) return token;
    const href = token.match(/\bhref\s*=\s*"([^"]+)"/i)?.[1] ?? "";
    if (!href || /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(href)) return token;
    const preload = token
      .replace(/\srel\s*=\s*"stylesheet"/i, "")
      .replace(
        /^<link\b/i,
        "<link rel=\"preload\" as=\"style\" class=\"app-stylesheet\" onload=\"this.onload=null;this.rel='stylesheet'\"",
      );
    const fallback = token.replace(/^<link\b/i, "<link data-css-fallback");
    return `${preload}<noscript>${fallback}</noscript>`;
  });
}
