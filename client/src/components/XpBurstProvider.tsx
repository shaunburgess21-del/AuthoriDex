import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Floater, XpBurstAccent } from "@/components/XpBurst";

const LazyXpBurstLayer = lazy(() =>
  import("@/components/XpBurstLayer").then((m) => ({ default: m.XpBurstLayer })),
);

type TriggerEvent = MouseEvent | React.MouseEvent;

function getRouteAccent(): XpBurstAccent {
  if (typeof window === "undefined") return "cyan";
  const path = window.location.pathname;
  if (path.startsWith("/predict") || path.startsWith("/markets")) return "violet";
  if (path === "/" || path.startsWith("/home")) return "blue";
  return "cyan";
}

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
  const [burstLayerMounted, setBurstLayerMounted] = useState(false);
  const idRef = useRef(0);

  const removeFloater = useCallback((id: number) => {
    setFloaters((prev) => prev.filter((f) => f.id !== id));
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
        y = window.innerHeight * 0.4;
      } else {
        return;
      }

      const accent = getRouteAccent();
      setBurstLayerMounted(true);
      setFloaters((prev) => [
        ...prev,
        { id: idRef.current++, x, y, amount, reason, accent },
      ]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("XpBurst trigger failed:", err);
    }
  }, []);

  const portalTarget = typeof document !== "undefined" ? document.body : null;

  return (
    <XpBurstContext.Provider value={{ trigger }}>
      {children}
      {burstLayerMounted &&
        portalTarget &&
        floaters.length > 0 &&
        createPortal(
          <Suspense fallback={null}>
            <LazyXpBurstLayer floaters={floaters} onComplete={removeFloater} />
          </Suspense>,
          portalTarget,
        )}
    </XpBurstContext.Provider>
  );
}

export default XpBurstProvider;
