import { Link, useLocation } from "wouter";
import { Fragment } from "react";

interface FooterLink {
  label: string;
  href: string;
  testId: string;
}

/** Inline links shown in the footer row. Order is intentional:
 * the "load-bearing" legal docs come first (Terms / Privacy /
 * Refund), and Contact closes the row as the human-help
 * affordance.
 *
 * Content & Takedown is intentionally absent here. Its audience
 * is external (celebrities, managers, lawyers, copyright
 * holders) who reach it via search or via the cross-links
 * inside Terms of Service §6, §7, §10, and §17. Surfacing it in
 * every footer would be heavy for casual users who don't need
 * it. The page itself remains live at /takedown.
 *
 * Pricing and product navigation are likewise omitted — they
 * live in the top nav and user dropdown already, and repeating
 * them in the footer would push back toward the SaaS-y
 * "site map" feel we're explicitly moving away from. */
const FOOTER_LINKS: FooterLink[] = [
  { label: "Terms", href: "/terms", testId: "footer-terms" },
  { label: "Privacy", href: "/privacy", testId: "footer-privacy" },
  { label: "Refund", href: "/refund-policy", testId: "footer-refund" },
  { label: "Contact", href: "/contact", testId: "footer-contact" },
];

/** Routes where the footer is suppressed.
 *
 * Auth screens (centered card layout, focused conversion path)
 * and admin tooling don't benefit from the public footer — the
 * BottomNav follows the same self-hide rule, keeping behaviour
 * consistent. Legal links remain accessible via the disclaimer
 * text on /login and the ToS-checkbox on /login/welcome. */
function shouldHideFooter(pathname: string): boolean {
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  return false;
}

export function Footer() {
  const [location] = useLocation();
  if (shouldHideFooter(location)) return null;

  const year = new Date().getFullYear();

  return (
    <footer
      className="border-t border-border/60 mt-8 pb-20 md:pb-0"
      data-testid="site-footer"
    >
      <div className="container mx-auto px-4 py-5 md:py-6">
        {/* Inline link row: copyright + legal links on a single
            line on desktop, wrapping center-aligned on mobile.
            `gap-x-3 gap-y-1` keeps tap targets comfortable when
            it wraps to two rows on narrow screens without going
            full row-stack. */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span data-testid="footer-copyright">
            © {year} VoxDex (Pty) Ltd
          </span>
          {FOOTER_LINKS.map((link) => (
            <Fragment key={link.label}>
              <span aria-hidden="true" className="text-muted-foreground/40">
                ·
              </span>
              <Link
                href={link.href}
                className="transition-colors hover:text-foreground"
                data-testid={link.testId}
              >
                {link.label}
              </Link>
            </Fragment>
          ))}
        </div>

        {/* One-line disclaimer keeps the load-bearing legal copy
            (entity + entertainment-only + not-financial-advice +
            no-cash-value) without the visual heft of a paragraph
            block. The "not financial advice" clause stays inline
            on every page because VoxDex's visual language —
            trend-score charts, prediction markets, leaderboards
            ranking "predictors" — borrows from financial UI, and
            disclaimer prominence is meaningful in case law. Terms
            of Service carries the long-form equivalents; this row
            is the at-a-glance reminder. */}
        <p className="mx-auto mt-3 max-w-2xl text-center text-[11px] leading-relaxed text-muted-foreground/80">
          VoxDex is operated by VoxDex (Pty) Ltd. Provided for
          entertainment only — trend scores are not financial advice
          and credits have no cash value.
        </p>
      </div>
    </footer>
  );
}
