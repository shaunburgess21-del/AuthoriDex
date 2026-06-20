import { cn } from "@/lib/utils";
import { glowClassFor } from "@/lib/gamification-content";

/** Pulse-card glow for predict detail section Cards — violet Predict accent, no hover lift. */
export function predictDetailSectionCardClass(...extra: Parameters<typeof cn>) {
  return cn("shadow-none pulse-card-flush", glowClassFor("predict"), ...extra);
}
