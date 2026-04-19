import { useEffect } from "react";
import { motion } from "framer-motion";

export type XpBurstAccent = "cyan" | "violet" | "blue";

export interface Floater {
  id: number;
  x: number;
  y: number;
  amount: number;
  reason?: string;
  accent: XpBurstAccent;
}

interface XpBurstProps {
  floater: Floater;
  onComplete: (id: number) => void;
}

const ACCENT_CLASSES: Record<XpBurstAccent, string> = {
  cyan: "text-cyan-500 dark:text-cyan-400 drop-shadow-[0_0_14px_rgba(34,211,238,0.9)]",
  violet: "text-violet-500 dark:text-violet-400 drop-shadow-[0_0_14px_rgba(139,92,246,0.9)]",
  blue: "text-blue-500 dark:text-blue-400 drop-shadow-[0_0_14px_rgba(59,130,246,0.9)]",
};

/**
 * Single floating "+N XP" element. Animates up + fades + scales over 1.3s,
 * then self-removes via onComplete(id). Framer-motion respects the app-level
 * MotionConfig reducedMotion="user" — users with prefers-reduced-motion set
 * see the result instantly without translation.
 */
export function XpBurst({ floater, onComplete }: XpBurstProps) {
  useEffect(() => {
    const timer = setTimeout(() => onComplete(floater.id), 1300);
    return () => clearTimeout(timer);
  }, [floater.id, onComplete]);

  return (
    <motion.div
      className="fixed z-[100] pointer-events-none font-bold text-2xl"
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: -90, scale: 1.6 }}
      transition={{ duration: 1.3, ease: "easeOut" }}
      style={{ left: floater.x, top: floater.y }}
    >
      <span className={ACCENT_CLASSES[floater.accent]}>
        +{floater.amount} XP
      </span>
    </motion.div>
  );
}

export default XpBurst;
