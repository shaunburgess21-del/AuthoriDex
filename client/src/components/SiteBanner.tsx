import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SiteBannerStyle, SiteBannerLinkDisplay } from "@shared/schema";

type PublicSiteBanner = {
  id: string;
  message: string;
  href: string | null;
  linkLabel: string | null;
  linkDisplay: SiteBannerLinkDisplay;
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
  }, [
    hidden,
    banner?.id,
    banner?.message,
    banner?.href,
    banner?.linkLabel,
    banner?.linkDisplay,
    banner?.dismissible,
  ]);

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

  const linkLabel = banner.linkLabel?.trim() || "Learn more";
  const isInlineLink = (banner.linkDisplay ?? "cta_chevron") === "inline_link";
  const messageClass = "text-sm font-medium leading-snug break-words";

  // Separate CTA with chevron; the whole block is the click target.
  // Use spans (not <p>) inside <a>/<Link> for valid HTML.
  const ctaChevronInner = (
    <>
      <span className={messageClass}>{banner.message}</span>
      {banner.href && (
        <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-semibold opacity-90">
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const className = cn(
    "fixed top-0 left-0 right-0 z-30 px-3 py-2.5",
    "pt-[max(0.5rem,env(safe-area-inset-top))]",
    STYLE_CLASSES[banner.style] ?? STYLE_CLASSES.promo,
  );

  // Railway-style: only the link text is clickable; message stays plain.
  const ctaClass =
    "flex flex-col items-center justify-center gap-1 min-w-0 text-center sm:flex-row sm:gap-2";

  let content: ReactNode;
  if (banner.href && isInlineLink) {
    content = (
      <p className="text-sm font-medium leading-snug break-words text-center">
        {banner.message}{" "}
        <BannerCta
          href={banner.href}
          className="font-semibold underline underline-offset-2 hover:opacity-90"
        >
          {linkLabel}
        </BannerCta>
      </p>
    );
  } else if (banner.href) {
    content = (
      <BannerCta href={banner.href} className={cn(ctaClass, "hover:opacity-90")}>
        {ctaChevronInner}
      </BannerCta>
    );
  } else {
    content = (
      <div className={ctaClass}>
        <p className={messageClass}>{banner.message}</p>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Site announcement"
      data-testid="site-banner"
      className={className}
    >
      <div className="grid w-full grid-cols-[minmax(2rem,auto)_1fr_minmax(2rem,auto)] items-center gap-2 sm:grid-cols-[minmax(2.5rem,auto)_1fr_minmax(2.5rem,auto)]">
        <div aria-hidden className="w-8 shrink-0 sm:w-10" />
        <div className="flex justify-center items-center min-w-0">{content}</div>
        <div className="flex justify-end items-center w-8 shrink-0 sm:w-10">
          {banner.dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              className="flex min-h-10 min-w-10 items-center justify-center rounded-md opacity-80 hover:opacity-100 hover:bg-black/20"
              aria-label="Dismiss announcement"
              data-testid="button-dismiss-site-banner"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
