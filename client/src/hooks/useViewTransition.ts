import { useCallback } from "react";
import { useLocation } from "wouter";

/**
 * Navigation wrapper that uses the View Transitions API when available,
 * falling back to instant navigation on unsupported browsers.
 */
export function useViewTransitionNavigate() {
  const [, setLocation] = useLocation();

  const navigate = useCallback(
    (to: string) => {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          setLocation(to);
        });
      } else {
        setLocation(to);
      }
    },
    [setLocation],
  );

  return navigate;
}
