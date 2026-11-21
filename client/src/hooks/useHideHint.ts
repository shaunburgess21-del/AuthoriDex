import { useCallback, useEffect, useSyncExternalStore, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  dismissHideHintDisplay,
  getHideHintDisplay,
  registerHideHintCard,
  retainHideHintSurface,
  subscribeHideHintDisplay,
} from "@/lib/hideHintController";
import { isHideHintFeedPath, normalizeHideHintPath } from "@/lib/hideHintGate";

/**
 * Watches one live category chip. `track` should be true only when the chip
 * menu is enabled and Hide card is in it. The hook itself also requires a
 * signed-in user on /, /vote, or /predict.
 */
export function useHideHint(options: { track: boolean; cardId: string | null }): {
  showHint: boolean;
  chipElement: HTMLButtonElement | null;
  setChipElement: (node: HTMLButtonElement | null) => void;
  dismissHint: () => void;
} {
  const { user } = useAuth();
  const [location] = useLocation();
  const [chipNode, setChipNode] = useState<HTMLButtonElement | null>(null);
  const display = useSyncExternalStore(
    subscribeHideHintDisplay,
    getHideHintDisplay,
    getHideHintDisplay,
  );

  const setChipElement = useCallback((node: HTMLButtonElement | null) => {
    setChipNode((current) => (current === node ? current : node));
  }, []);

  const cardId = options.cardId;
  const onFeed = isHideHintFeedPath(location);
  const track = options.track && onFeed && !!user?.id && !!cardId;

  useEffect(() => {
    if (!track || !cardId || !user?.id || !chipNode) return;
    const release = retainHideHintSurface({
      signedIn: true,
      userId: user.id,
      path: normalizeHideHintPath(location),
    });
    const unregister = registerHideHintCard(cardId, chipNode);
    return () => {
      unregister();
      release();
    };
  }, [track, cardId, user?.id, location, chipNode]);

  const showHint = track && display.cardId === cardId && display.element === chipNode;

  return {
    showHint,
    chipElement: chipNode,
    setChipElement,
    dismissHint: dismissHideHintDisplay,
  };
}
