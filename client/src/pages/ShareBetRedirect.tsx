import { useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Sprint 3 — handles human navigation to a `/share/bet/:betId` URL.
 *
 * Bots never reach this component because Vercel rewrites their UA
 * directly to `/api/og/share/bet/:betId`. Humans land here, we hit the
 * lean JSON resolver, then forward them to the canonical market
 * detail page so the share URL acts like a real link.
 *
 * Falls back to `/predict` if the resolver fails or the bet was
 * deleted — better than a dead-end "not found" since the goal of the
 * share URL is to drive traffic into the predict surface.
 */
export default function ShareBetRedirect() {
  const [, params] = useRoute<{ betId: string }>("/share/bet/:betId");
  const [, setLocation] = useLocation();
  const betId = params?.betId ?? "";

  useEffect(() => {
    if (!betId) {
      setLocation("/predict", { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/share/bet/${encodeURIComponent(betId)}/resolve`,
          { credentials: "omit" },
        );
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as {
            canonicalUrl?: string;
            found?: boolean;
          };
          // The resolver returns absolute URLs; strip the origin so the
          // wouter setLocation stays in-app and we don't bounce through
          // a full reload.
          let target = data.canonicalUrl ?? "/predict";
          try {
            const parsed = new URL(target);
            if (parsed.origin === window.location.origin) {
              target = parsed.pathname + parsed.search + parsed.hash;
            }
          } catch {
            // target wasn't absolute; treat as-is.
          }
          setLocation(target, { replace: true });
        } else {
          setLocation("/predict", { replace: true });
        }
      } catch {
        if (!cancelled) setLocation("/predict", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [betId, setLocation]);

  // Brief skeleton so the screen isn't blank during the resolve hop.
  // Most users will see <100ms of this before the redirect lands.
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
      <Skeleton className="h-8 w-48 rounded-lg" />
      <Skeleton className="h-4 w-64 rounded" />
    </div>
  );
}
