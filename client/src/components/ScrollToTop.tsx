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

    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location]);

  return null;
}
