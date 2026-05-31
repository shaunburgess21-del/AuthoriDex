import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoxDexLogo } from "@/components/VoxDexLogo";
import { HeaderUserActions } from "@/components/HeaderUserActions";
import { cn } from "@/lib/utils";

type ActiveNav = "home" | "vote" | "predict" | "insights";
type LogoVariant = "default" | "vote" | "predict";

interface SiteHeaderProps {
  /** Highlights the matching nav item with its tinted color. */
  active?: ActiveNav;
  /** Logo color variant (vote = cyan, predict = violet). */
  logoVariant?: LogoVariant;
  /**
   * Optional override for the Home logo button. HomePage uses this to also
   * reset its in-page view + scroll to top instead of just navigating.
   */
  onHomeClick?: () => void;
  /**
   * Optional mobile-only extras placed before the bell/avatar cluster on
   * the right. Predict uses this for the Vox credits pill + rules button.
   */
  mobileExtras?: ReactNode;
  /**
   * Back-arrow visibility. `"mobile"` (default) shows the arrow only on
   * mobile (`md:hidden`); `"always"` keeps it on every breakpoint (used
   * by detail/profile sub-pages whose only back affordance lives in the
   * header); `"none"` omits the button entirely (used by the Home page).
   */
  backButton?: "mobile" | "always" | "none";
}

const ACTIVE_CLASS: Record<ActiveNav, string> = {
  home: "text-blue-700 dark:text-blue-400",
  vote: "text-cyan-700 dark:text-cyan-400",
  predict: "text-violet-700 dark:text-violet-500",
  insights: "text-blue-600 dark:text-blue-400",
};

const NAV_ITEMS: Array<{ key: ActiveNav; label: string; href: string; testId: string }> = [
  { key: "home", label: "Home", href: "/", testId: "nav-home-desktop" },
  { key: "vote", label: "Vote", href: "/vote", testId: "nav-vote-desktop" },
  { key: "predict", label: "Predict", href: "/predict", testId: "nav-predict-desktop" },
  { key: "insights", label: "Insights", href: "/insights", testId: "nav-insights-desktop" },
];

/**
 * Single shared top navigation header used on every hub page. Three-column
 * CSS grid keeps the menu truly centered on the page regardless of how
 * wide the left logo cluster or right actions cluster grow.
 */
export function SiteHeader({
  active,
  logoVariant = "default",
  onHomeClick,
  mobileExtras,
  backButton = "mobile",
}: SiteHeaderProps) {
  const [, setLocation] = useLocation();

  const handleLogoClick = () => {
    if (onHomeClick) {
      onHomeClick();
      return;
    }
    setLocation("/");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-3 md:grid md:grid-cols-[1fr_auto_1fr]">
        <div className="flex items-center gap-2 min-w-0 justify-self-start">
          {backButton !== "none" && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("shrink-0", backButton === "mobile" && "md:hidden")}
              onClick={() => {
                if (typeof window !== "undefined" && window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation("/");
                }
              }}
              aria-label="Go back"
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          <button
            type="button"
            onClick={handleLogoClick}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="button-logo-home"
          >
            <VoxDexLogo size={32} variant={logoVariant} />
            <span className="font-serif font-bold text-xl hidden sm:block">VoxDex</span>
          </button>
        </div>

        <nav
          className="hidden md:flex items-center gap-1 justify-self-center"
          data-testid="site-header-nav"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.key;
            return (
              <Link key={item.key} href={item.href}>
                <Button
                  variant="ghost"
                  className={cn("text-base px-3", isActive && ACTIVE_CLASS[item.key])}
                  data-testid={item.testId}
                >
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 md:gap-3 justify-self-end">
          {mobileExtras}
          <HeaderUserActions />
        </div>
      </div>
    </header>
  );
}
