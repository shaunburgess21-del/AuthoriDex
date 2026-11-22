import { createContext, useContext, type ReactNode } from "react";

export type VotedCardAccent = "cyan" | "blue";

export interface VotedCardLeaveOptions {
  /** Remove on this frame. Horizontal carousels and reduced motion use this. */
  immediate?: boolean;
}

export interface VotedCardRetainContextValue {
  watching: (key: string) => boolean;
  collapsing: (key: string) => boolean;
  onLeave: (key: string, options?: VotedCardLeaveOptions) => void;
  highlightKey: string | null;
  accent: VotedCardAccent;
}

const VotedCardRetainContext = createContext<VotedCardRetainContextValue | null>(null);

export function VotedCardRetainProvider({
  value,
  children,
}: {
  value: VotedCardRetainContextValue;
  children: ReactNode;
}) {
  return <VotedCardRetainContext.Provider value={value}>{children}</VotedCardRetainContext.Provider>;
}

export function useVotedCardRetain(): VotedCardRetainContextValue | null {
  return useContext(VotedCardRetainContext);
}
