import { useEffect } from "react";
import { Trophy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getRankConfig } from "@/lib/gamification-content";
import { capabilitiesUnlockedAtTier } from "@shared/rank-config";
import { type RankUpPayload } from "@/lib/rank-up-events";

// Re-export so existing `from "@/components/RankUpModal"` imports keep
// working; new dispatch call sites should import "@/lib/rank-up-events"
// directly (it avoids pulling this modal chunk).
export { dispatchRankUp, type RankUpPayload } from "@/lib/rank-up-events";

// NOTE: the event-listening host now lives in App.tsx (RankUpModalGate) so
// this module — Dialog, confetti, rank config — is only fetched when a
// promotion actually fires.

interface RankUpModalProps {
  payload: RankUpPayload;
  onClose: () => void;
}

/**
 * Full-screen rank-up celebration. Mounted lazily by RankUpModalHost
 * when a rank_up notification arrives. Replaces the auto-toast that
 * used to fire for `kind === "rank_up"` in useNotificationsRealtime.
 *
 * Visual contract (matches StreakToast token vocabulary):
 *   - rank colour drives the glow + icon tint via inline CSS variables
 *   - Description copy = first sentence of the tier description from
 *     shared/rank-config.ts so the seed table is the single source of
 *     truth for tone-of-voice
 *   - "Now unlocked" section renders ONLY for the new tier's gates,
 *     not the cumulative set, so a Tier-3 promotion doesn't re-show
 *     the Tier-2 unlocks the user already has
 */
export function RankUpModal({ payload, onClose }: RankUpModalProps) {
  const config = getRankConfig(payload.newRank);
  const Icon = config.icon;
  const newCapabilities = capabilitiesUnlockedAtTier(config.tier);

  // First sentence of the description — keeps the modal scannable
  // and mirrors the tier-card excerpt used on HowItWorks.
  const subDescription = config.description.split(". ")[0];
  const subDescriptionWithStop = subDescription.endsWith(".")
    ? subDescription
    : `${subDescription}.`;

  // Confetti on mount. Two bursts staggered ~150ms apart give a
  // richer feel than a single shot without bumping particle count
  // high enough to jank low-end devices. canvas-confetti is dynamic-
  // imported so it stays out of the entry bundle — a promotion is a
  // rare event and a few frames of import latency are invisible.
  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const fireBurst = (originX: number) => {
        confetti({
          particleCount: 70,
          spread: 70,
          startVelocity: 35,
          origin: { x: originX, y: 0.4 },
          colors: [config.color, "#ffffff", "#fbbf24"],
          disableForReducedMotion: true,
        });
      };
      fireBurst(0.3);
      t = setTimeout(() => fireBurst(0.7), 150);
    });
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [config.color]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md text-center sm:rounded-2xl border-2"
        style={{ borderColor: `${config.color}55` }}
      >
        <div className="flex flex-col items-center gap-4 py-2">
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-full"
            style={{
              background: `radial-gradient(circle, ${config.color}33 0%, transparent 70%)`,
            }}
          >
            <Icon
              className="h-12 w-12"
              style={{ color: config.color }}
              strokeWidth={1.5}
            />
            <Sparkles
              className="absolute -right-1 -top-1 h-5 w-5 text-amber-400"
              strokeWidth={2}
            />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              You've ranked up!
            </p>
            <h2
              className="text-3xl font-bold leading-tight"
              style={{ color: config.color }}
            >
              {config.name}
            </h2>
            <p className="text-sm text-muted-foreground px-2">
              You're now a {config.name} — {subDescriptionWithStop}
            </p>
          </div>

          <div className="w-full rounded-lg bg-muted/50 px-4 py-3 text-sm">
            <span className="font-medium text-muted-foreground">
              Total XP:
            </span>{" "}
            <span className="font-bold tabular-nums">
              {payload.xp.toLocaleString()}
            </span>
          </div>

          {payload.newPersonalBest && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
              <Trophy className="h-4 w-4" />
              <span>New personal best</span>
            </div>
          )}

          {newCapabilities.length > 0 && (
            <div className="w-full text-left">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Now unlocked
              </p>
              <ul className="space-y-2">
                {newCapabilities.map((cap) => (
                  <li
                    key={cap.capability}
                    className="rounded-md border bg-background/40 px-3 py-2"
                  >
                    <p className="text-sm font-medium">{cap.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {cap.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button onClick={onClose} className="w-full mt-2">
            Keep VoxMaxxing
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
