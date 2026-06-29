import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ReferralPromptModal,
  type ReferralPromptSource,
} from "./ReferralPromptModal";

interface ReferralModalContextValue {
  /** Open the referral modal. `source` tunes the headline + copy. */
  open: (source?: ReferralPromptSource) => void;
  close: () => void;
  isOpen: boolean;
}

const ReferralModalContext = createContext<ReferralModalContextValue | null>(
  null,
);

/**
 * App-root provider that owns a single ReferralPromptModal instance so
 * every surface (engagement gate, out-of-Vox banners, user menu) opens
 * the same modal via `useReferralModal().open(source)`. Mirrors the
 * ShareCardProvider pattern already mounted in App.tsx.
 */
export function ReferralModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<ReferralPromptSource>("auto");

  const open = useCallback((nextSource: ReferralPromptSource = "auto") => {
    setSource(nextSource);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<ReferralModalContextValue>(
    () => ({ open, close, isOpen }),
    [open, close, isOpen],
  );

  return (
    <ReferralModalContext.Provider value={value}>
      {children}
      <ReferralPromptModal
        open={isOpen}
        onOpenChange={setIsOpen}
        source={source}
      />
    </ReferralModalContext.Provider>
  );
}

export function useReferralModal(): ReferralModalContextValue {
  const ctx = useContext(ReferralModalContext);
  if (!ctx) {
    throw new Error(
      "useReferralModal must be used within a ReferralModalProvider",
    );
  }
  return ctx;
}
