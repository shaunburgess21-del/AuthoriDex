import { AnimatePresence } from "framer-motion";
import { XpBurst, type Floater } from "@/components/XpBurst";

interface XpBurstLayerProps {
  floaters: Floater[];
  onComplete: (id: number) => void;
}

/** Lazy-loaded portal layer — keeps framer-motion out of the app-shell entry chunk. */
export function XpBurstLayer({ floaters, onComplete }: XpBurstLayerProps) {
  return (
    <AnimatePresence>
      {floaters.map((f) => (
        <XpBurst key={f.id} floater={f} onComplete={onComplete} />
      ))}
    </AnimatePresence>
  );
}
