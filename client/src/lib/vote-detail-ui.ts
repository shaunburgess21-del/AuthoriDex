import { cn } from "@/lib/utils";
import { glowClassFor } from "@/lib/gamification-content";

/** Pulse-card glow for vote detail section Cards — cyan Vote accent, no hover lift. */
export function voteDetailSectionCardClass(...extra: Parameters<typeof cn>) {
  return cn("shadow-none pulse-card-flush", glowClassFor("vote"), ...extra);
}
