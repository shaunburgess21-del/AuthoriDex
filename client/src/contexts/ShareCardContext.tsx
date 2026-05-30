import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ShareCardData } from "@/components/share/ShareCard";

const LazyShareCardModal = lazy(() =>
  import("@/components/share/ShareCardModal").then((m) => ({
    default: m.ShareCardModal,
  })),
);

/**
 * Arguments accepted by `openShareCard`. Mirrors the `ShareCardModal`
 * props 1:1 minus the `open` / `onOpenChange` lifecycle — the context
 * owns those.
 *
 * `fallbackText` is what the native Web Share API copies when the user's
 * device can't share the rendered image. `shareUrl` is the link inserted
 * by the share sheet. `filenameBase` is the prefix used when the user
 * picks "Download image".
 */
export interface ShareCardOpenArgs {
  data: ShareCardData;
  fallbackText?: string;
  shareUrl?: string;
  filenameBase?: string;
}

interface ShareCardContextValue {
  openShareCard: (args: ShareCardOpenArgs) => void;
}

const ShareCardContext = createContext<ShareCardContextValue | null>(null);

/**
 * Global mount for the share-card modal.
 *
 * Why a single mount rather than per-page <ShareCardModal />:
 *   - Every trigger surface (post-trade toast, /me/predictions Open tab,
 *     /u/<user> Open Positions panel, settled-win row, portfolio "Share
 *     Stats" buttons) wants to pop the exact same modal. Mounting per
 *     surface duplicates state and forces every caller to thread an open
 *     flag through props.
 *   - The modal is heavy enough that we don't want it instantiated on
 *     every page mount — but light enough that a single app-level mount
 *     is fine, since it returns null until `open` flips.
 *
 * Usage:
 *   const { openShareCard } = useShareCard();
 *   openShareCard({ data: { variant: "trade", ... }, fallbackText, shareUrl });
 */
export function ShareCardProvider({ children }: { children: ReactNode }) {
  const [args, setArgs] = useState<ShareCardOpenArgs | null>(null);

  const openShareCard = useCallback((next: ShareCardOpenArgs) => {
    setArgs(next);
  }, []);

  const value = useMemo<ShareCardContextValue>(
    () => ({ openShareCard }),
    [openShareCard],
  );

  return (
    <ShareCardContext.Provider value={value}>
      {children}
      {args !== null && (
        <Suspense fallback={null}>
          <LazyShareCardModal
            open
            onOpenChange={(next) => {
              if (!next) setArgs(null);
            }}
            data={args.data}
            fallbackText={args.fallbackText}
            shareUrl={args.shareUrl}
            filenameBase={args.filenameBase}
          />
        </Suspense>
      )}
    </ShareCardContext.Provider>
  );
}

/**
 * Hook accessor for the share-card modal. Throws if called outside the
 * provider — surfaces wiring bugs at dev time rather than silently no-op
 * at runtime.
 */
export function useShareCard(): ShareCardContextValue {
  const ctx = useContext(ShareCardContext);
  if (!ctx) {
    throw new Error(
      "useShareCard must be used inside <ShareCardProvider> — check App.tsx mount.",
    );
  }
  return ctx;
}
