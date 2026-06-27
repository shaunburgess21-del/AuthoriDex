import { useEffect, useState } from "react";

/**
 * Returns `false` on first paint, then flips to `true` once the browser is
 * idle (or after `timeout` ms as a ceiling). Used to defer non-critical data
 * fetching so the primary above-the-fold content renders and its requests go
 * out first on slow connections, instead of competing with a burst of
 * secondary queries.
 */
export function useDeferredReady(timeout = 1200): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setReady(true);
    };

    const ric = (
      window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          opts?: { timeout: number },
        ) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;

    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (ric) {
      idleId = ric(done, { timeout });
    } else {
      timer = setTimeout(done, 200);
    }

    return () => {
      cancelled = true;
      const cic = (
        window as unknown as { cancelIdleCallback?: (id: number) => void }
      ).cancelIdleCallback;
      if (idleId !== undefined && cic) cic(idleId);
      if (timer) clearTimeout(timer);
    };
  }, [timeout]);

  return ready;
}
