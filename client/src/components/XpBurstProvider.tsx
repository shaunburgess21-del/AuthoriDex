import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { XpBurst, type Floater } from "@/components/XpBurst";

type TriggerEvent = MouseEvent | React.MouseEvent;

interface XpBurstContextValue {
  trigger: (amount: number, event?: TriggerEvent, reason?: string) => void;
}

const noop: XpBurstContextValue = { trigger: () => {} };
const XpBurstContext = createContext<XpBurstContextValue>(noop);

/**
 * useXpBurst — get { trigger } from anywhere under XpBurstProvider.
 * If called outside the provider, returns a silent no-op so failed bursts
 * never break the calling mutation's onSuccess flow.
 */
export function useXpBurst(): XpBurstContextValue {
  return useContext(XpBurstContext);
}

interface XpBurstProviderProps {
  children: ReactNode;
}

export function XpBurstProvider({ children }: XpBurstProviderProps) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const idRef = useRef(0);

  const removeFloater = useCallback((id: number) => {
    setFloaters(prev => prev.filter(f => f.id !== id));
  }, []);

  const trigger = useCallback((amount: number, event?: TriggerEvent, reason?: string) => {
    try {
      if (!amount || amount <= 0) return;

      let x: number;
      let y: number;
      if (event && typeof event.clientX === "number" && typeof event.clientY === "number") {
        x = event.clientX - 40;
        y = event.clientY - 20;
      } else if (typeof window !== "undefined") {
        x = window.innerWidth / 2 - 40;
        y = 100;
      } else {
        return;
      }

      setFloaters(prev => [...prev, { id: idRef.current++, x, y, amount, reason }]);
    } catch (err) {
      // Never let a burst failure break the calling mutation's flow.
      // eslint-disable-next-line no-console
      console.error("XpBurst trigger failed:", err);
    }
  }, []);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <XpBurstContext.Provider value={{ trigger }}>
      {children}
      {portalTarget &&
        createPortal(
          <AnimatePresence>
            {floaters.map(f => (
              <XpBurst key={f.id} floater={f} onComplete={removeFloater} />
            ))}
          </AnimatePresence>,
          portalTarget,
        )}
    </XpBurstContext.Provider>
  );
}

export default XpBurstProvider;
