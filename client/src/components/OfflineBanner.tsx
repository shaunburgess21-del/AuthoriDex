import { useLayoutEffect, useRef, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAndroidNetworkUi, useNetworkStatus } from "@/hooks/useNetworkStatus";

/**
 * One persistent strip while the Android shell is offline, then a short
 * "Back online" confirmation. Not a toast: radio flaps are debounced in
 * `networkStatus` before this phase changes, and the strip hides itself.
 * Website, PWA, and iOS render nothing.
 */
export function OfflineBanner() {
  const android = useAndroidNetworkUi();
  const link = useNetworkStatus();
  const visible = android && link.banner !== "hidden";
  const ref = useRef<HTMLDivElement>(null);
  const [atTop, setAtTop] = useState(true);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible) {
      root.style.setProperty("--offline-banner-height", "0px");
      return;
    }

    const readSiteBanner = () => {
      const px = parseFloat(root.style.getPropertyValue("--site-banner-height"));
      setAtTop(!Number.isFinite(px) || px <= 0);
    };
    readSiteBanner();
    const obs = new MutationObserver(readSiteBanner);
    obs.observe(root, { attributes: true, attributeFilter: ["style"] });

    const writeHeight = () => {
      root.style.setProperty("--offline-banner-height", `${ref.current?.offsetHeight ?? 0}px`);
    };
    writeHeight();
    const ro = ref.current ? new ResizeObserver(writeHeight) : null;
    if (ref.current) ro?.observe(ref.current);

    return () => {
      obs.disconnect();
      ro?.disconnect();
      root.style.setProperty("--offline-banner-height", "0px");
    };
  }, [visible, link.banner]);

  if (!visible) return null;

  const restored = link.banner === "restored";

  return (
    <div
      role="status"
      aria-live="polite"
      ref={ref}
      data-testid="offline-banner"
      data-offline-phase={link.banner}
      className={cn(
        "fixed left-0 right-0 z-30 px-3 pb-2.5 text-center top-[var(--site-banner-height,0px)]",
        atTop ? "pt-[max(0.625rem,env(safe-area-inset-top))]" : "pt-2.5",
        restored
          ? "bg-primary/15 border-b border-primary/30 text-foreground"
          : "bg-amber-950/90 border-b border-amber-500/40 text-amber-50",
      )}
    >
      <p className="inline-flex items-center justify-center gap-2 text-sm font-medium leading-snug">
        {restored ? (
          <Wifi className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
        )}
        {restored ? "Back online" : "You're offline. We'll refresh when you reconnect."}
      </p>
    </div>
  );
}
