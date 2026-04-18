import { useEffect } from "react";
import { motion } from "framer-motion";

export interface Floater {
  id: number;
  x: number;
  y: number;
  amount: number;
  reason?: string;
}

interface XpBurstProps {
  floater: Floater;
  onComplete: (id: number) => void;
}

/**
 * Single floating "+N XP" element. Animates up + fades + scales over 1s,
 * then self-removes via onComplete(id). Framer-motion respects the app-level
 * MotionConfig reducedMotion="user" — users with prefers-reduced-motion set
 * see the result instantly without translation.
 */
export function XpBurst({ floater, onComplete }: XpBurstProps) {
  useEffect(() => {
    const timer = setTimeout(() => onComplete(floater.id), 1000);
    return () => clearTimeout(timer);
  }, [floater.id, onComplete]);

  return (
    <motion.div
      className="fixed z-[100] pointer-events-none font-bold text-lg"
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: -60, scale: 1.2 }}
      transition={{ duration: 1, ease: "easeOut" }}
      style={{ left: floater.x, top: floater.y }}
    >
      <span className="text-cyan-600 dark:text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.8)]">
        +{floater.amount} XP
      </span>
    </motion.div>
  );
}

export default XpBurst;
