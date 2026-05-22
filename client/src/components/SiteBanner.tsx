import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SiteBannerStyle } from "@shared/schema";

type PublicSiteBanner = {
  id: string;
  message: string;
  href: string | null;
  style: SiteBannerStyle;
  dismissible: boolean;
};

const STYLE_CLASSES: Record<SiteBannerStyle, string> = {
  promo:
    "bg-gradient-to-r from-violet-950/95 via-indigo-950/95 to-cyan-950/95 border-b border-violet-500/40 text-violet-50",
  info: "bg-primary/15 border-b border-primary/30 text-foreground",
  warning:
    "bg-amber-950/90 border-b border-amber-500/40 text-amber-50",
};

function dismissKey(id: string) {
  return `site_banner_dismissed:${id}`;
}

function isDismissed(id: string): boolean {
  try {
    return sessionStorage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}

function setDismissed(id: string) {
  try {
    sessionStorage.setItem(dismissKey(id), "1");
  } catch {
    /* ignore */
  }
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function BannerCta({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: ReactNode;
}) {
  if (isExternalHref(href)) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }
  const path = href.startsWith("/") ? href : `/${href}`;
  return (
    <Link href={path} className={className}>
      {children}
    </Link>
  );
}

export function SiteBanner() {
  const ref = useRef<HTMLDivElement>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  const { data } = useQuery<{ banner: PublicSiteBanner | null }>({
    queryKey: ["/api/site-banner"],
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const banner = data?.banner ?? null;
  const hidden =
    !banner ||
    dismissedId === banner?.id ||
    (banner?.dismissible && banner?.id ? isDismissed(banner.id) : false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (hidden || !ref.current) {
      root.style.setProperty("--site-banner-height", "0px");
      return;
    }
    const update = () => {
      const h = ref.current?.offsetHeight ?? 0;
      root.style.setProperty("--site-banner-height", `${h}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      root.style.setProperty("--site-banner-height", "0px");
    };
  }, [hidden, banner?.id, banner?.message, banner?.href]);

  useEffect(() => {
    if (banner?.id && dismissedId && dismissedId !== banner.id) {
      setDismissedId(null);
    }
  }, [banner?.id, dismissedId]);

  if (hidden || !banner) return null;

  const handleDismiss = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    if (banner.dismissible) {
      setDismissed(banner.id);
      setDismissedId(banner.id);
    }
  };

  const inner = (
    <>
      <p className="text-sm font-medium leading-snug flex-1 min-w-0">{banner.message}</p>
      {banner.href && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold opacity-90">
          Learn more
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const className = cn(
    "fixed top-0 left-0 right-0 z-30 flex items-center gap-2 px-3 py-2.5",
    "pt-[max(0.5rem,env(safe-area-inset-top))]",
    STYLE_CLASSES[banner.style] ?? STYLE_CLASSES.promo,
  );

  const ctaClass = "flex flex-1 items-center gap-2 min-w-0 pr-8 hover:opacity-90";

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Site announcement"
      data-testid="site-banner"
      className={className}
    >
      {banner.href ? (
        <BannerCta href={banner.href} className={ctaClass}>
          {inner}
        </BannerCta>
      ) : (
        <div className={ctaClass}>{inner}</div>
      )}
      {banner.dismissible && (
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-md opacity-80 hover:opacity-100 hover:bg-black/20"
          aria-label="Dismiss announcement"
          data-testid="button-dismiss-site-banner"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
