import { Home, TrendingUp, Vote } from "lucide-react";
import { useLocation, Link } from "wouter";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/vote", label: "Vote", icon: Vote },
  { path: "/predict", label: "Predict", icon: TrendingUp },
];

export function BottomNav() {
  const [location] = useLocation();

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
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navigation"
      data-testid="nav-bottom"
    >
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
              className={`flex flex-col items-center justify-center gap-1 px-4 py-2 transition-colors ${
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
              <span className={`text-xs font-medium ${isActive ? "text-primary" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
