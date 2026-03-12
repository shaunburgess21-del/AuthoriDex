import { Home, TrendingUp, Heart } from "lucide-react";
import { useLocation, Link } from "wouter";

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { path: "/", label: "Home", icon: Home },
  { path: "/vote", label: "Vote", icon: Heart },
  { path: "/predict", label: "Predict", icon: TrendingUp },
];

export function BottomNav() {
  const [location] = useLocation();

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
