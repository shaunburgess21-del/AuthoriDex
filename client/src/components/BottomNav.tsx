import { Home, TrendingUp, Vote, LineChart, MessagesSquare } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useVisualViewportOffset } from "@/hooks/useVisualViewportOffset";
import { prefetchRoute } from "@/lib/routePrefetch";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  activeClass: string;
}

const navItems: NavItem[] = [
  { path: "/", label: "Home", icon: Home, activeClass: "text-blue-400" },
  { path: "/vote", label: "Vote", icon: Vote, activeClass: "text-cyan-400" },
  { path: "/predict", label: "Predict", icon: TrendingUp, activeClass: "text-violet-500" },
  { path: "/voices", label: "Voices", icon: MessagesSquare, activeClass: "text-amber-400" },
  { path: "/insights", label: "Insights", icon: LineChart, activeClass: "text-blue-400" },
];

export function BottomNav() {
  const [location] = useLocation();
  // Keep the nav glued to the visual viewport's bottom edge as Chrome's
  // bottom toolbar shows/hides. The hook returns a signed delta —
  // positive when the visual viewport extends below the layout
  // viewport (toolbar collapsed → translate down to close the gap),
  // negative when it ends above (translate up). See
  // useVisualViewportOffset for the full rationale.
  const viewportOffset = useVisualViewportOffset();

  // Auth flow pages own the full mobile viewport (centered card layout, no
  // app-shell padding) so the fixed nav covers their bottom content — most
  // visibly the "Back to Home" button on /login. Industry convention is to
  // hide bottom nav on auth routes anyway (X, Reddit, Polymarket, banking
  // apps) since the destinations don't make full sense pre-auth and the
  // user already has explicit "Back to Home" affordances inside the cards.
  if (location === "/login" || location.startsWith("/login/")) {
    return null;
  }

  // Admin routes have their own section-switcher bar at the bottom on mobile.
  // Showing the public Home/Vote/Predict nav here both blocks the admin nav
  // (both fixed at z-50) and is meaningless inside the admin tooling.
  if (location === "/admin" || location.startsWith("/admin/")) {
    return null;
  }

  return (
    <nav 
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur-xl md:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        transform: viewportOffset !== 0 ? `translateY(${viewportOffset}px)` : undefined,
        willChange: 'transform',
      }}
      aria-label="Navigation"
      data-testid="nav-bottom"
    >
      {/* Opaque bleed below the nav. Mobile browsers briefly report
          inconsistent viewport sizes while their toolbar animates, which can
          strand this fixed nav a toolbar-height above the true screen bottom
          (Android dynamic toolbars, iOS stale transforms, rubber-band
          overscroll). Rather than chasing perfect positioning during that
          window — the source of every past regression here — this extension
          hangs off the nav's bottom edge and covers any transient gap so page
          content can never show through. Fully opaque bg-background (not the
          nav's translucent blur) so it hides content regardless of
          backdrop-filter compositing; off-screen whenever the nav is anchored
          correctly. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 right-0 top-full h-[120px] bg-background"
      />
      <div className="flex items-center justify-around h-16">
        {navItems.map((item) => {
          const isActive = location === item.path || 
            (item.path === "/" && location === "/") ||
            (item.path !== "/" && location.startsWith(item.path));
          
          return (
            <Link
              key={item.path}
              href={item.path}
              aria-current={isActive ? "page" : undefined}
              onPointerEnter={() => prefetchRoute(item.path)}
              onTouchStart={() => prefetchRoute(item.path)}
              onFocus={() => prefetchRoute(item.path)}
              className={`flex flex-1 min-w-0 flex-col items-center justify-center gap-1 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isActive 
                  ? item.activeClass 
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? item.activeClass : ""}`} />
              <span className={`text-xs font-medium ${isActive ? item.activeClass : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
