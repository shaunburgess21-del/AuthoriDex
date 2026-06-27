/**
 * Lazy-route prefetching. The router lazy-loads every page chunk, so navigation
 * on a slow link waits for the chunk to download. Calling `prefetchRoute` on
 * hover/touch/focus warms the chunk ahead of the click.
 *
 * The dynamic import specifiers MUST match the ones in `App.tsx` so Vite maps
 * them to the same chunk (the prefetch and the real navigation reuse one file).
 */
const loaders: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/HomePage"),
  "/vote": () => import("@/pages/VotePage"),
  "/predict": () => import("@/pages/PredictPage"),
  "/voices": () => import("@/pages/VoicesPage"),
  "/insights": () => import("@/pages/InsightsPage"),
};

const prefetched = new Set<string>();

export function prefetchRoute(path: string): void {
  const loader = loaders[path];
  if (!loader || prefetched.has(path)) return;
  prefetched.add(path);
  loader().catch(() => {
    // Allow a later retry if the chunk failed to load (e.g. transient offline).
    prefetched.delete(path);
  });
}
