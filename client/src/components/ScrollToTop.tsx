import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

export function ScrollToTop() {
  const [location] = useLocation();
  const isPopRef = useRef(false);
  const prevLocationRef = useRef(location);

  useEffect(() => {
    const handlePopState = () => {
      isPopRef.current = true;
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (prevLocationRef.current === location) return;
    prevLocationRef.current = location;

    if (isPopRef.current) {
      isPopRef.current = false;
      return;
    }

    // If the new URL carries a fragment (e.g. /predict#jackpot from a
    // share link), let the per-page hash handler position the scroll —
    // jumping to the top first would cause a visible "snap up, snap
    // down" flicker. Pages without a hash handler still scroll to top
    // because the browser also fails to honour fragments on JS-routed
    // pushState transitions.
    if (typeof window !== "undefined" && window.location.hash) return;

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return null;
}
