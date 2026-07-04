import { createContext, useContext } from "react";

/**
 * Whether the insights tab a component lives in is the currently visible
 * one. Visited tabs stay mounted (CSS-hidden) for instant switching, so
 * polling tiles consume this to pause their refetch intervals while
 * hidden. Defaults to true for components rendered outside InsightsPage.
 */
export const InsightsTabActiveContext = createContext(true);

export function useInsightsTabActive(): boolean {
  return useContext(InsightsTabActiveContext);
}
