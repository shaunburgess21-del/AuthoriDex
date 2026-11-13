/**
 * Haptic cues for the Capacitor shells.
 *
 * Web and PWA no-op. The Web Vibration API is not used, so a browser
 * never buzzes.
 *
 * Android keeps the previous contract: one short ImpactStyle.Light
 * pulse after a confirmed success, and silence for errors, selection,
 * and reward notifications.
 *
 * iOS:
 *   - success → light impact (vote / prediction submit)
 *   - notify-success → success notification (streak / Vox reward)
 *   - error → error notification
 *   - selection → selection tick (tab bar, segmented controls)
 *
 * Plugin failures are swallowed so a missing vibrator cannot block the
 * vote or trade. A short gap collapses stacked confirmation cues.
 * Selection ticks are not gapped.
 */
import { Capacitor } from "@capacitor/core";

export const HAPTIC_SUCCESS_GAP_MS = 450;

export type HapticSurface = "android" | "ios" | "web";
export type HapticCue = "success" | "error" | "tap" | "selection" | "notify-success";
export type ResolvedHaptic =
  | "impact-light"
  | "notification-success"
  | "notification-error"
  | "selection";

export function hapticSurface(native: boolean, platform: string): HapticSurface {
  if (native && platform === "android") return "android";
  if (native && platform === "ios") return "ios";
  return "web";
}

/**
 * Android success stays a light impact. iOS maps each cue to the
 * matching UIFeedbackGenerator. Everything else is silent.
 */
export function resolveHapticCue(
  surface: HapticSurface,
  cue: HapticCue,
): ResolvedHaptic | null {
  if (surface === "android") {
    return cue === "success" ? "impact-light" : null;
  }
  if (surface !== "ios") return null;
  switch (cue) {
    case "success":
      return "impact-light";
    case "notify-success":
      return "notification-success";
    case "error":
      return "notification-error";
    case "selection":
      return "selection";
    default:
      return null;
  }
}

/** True when enough time has passed to allow another confirmation pulse. */
export function hapticGapElapsed(
  nowMs: number,
  lastPulseMs: number,
  gapMs = HAPTIC_SUCCESS_GAP_MS,
): boolean {
  return nowMs - lastPulseMs >= gapMs;
}

/** Selection ticks stay immediate. Confirmation cues share the gap. */
export function hapticCueUsesGap(cue: ResolvedHaptic): boolean {
  return cue !== "selection";
}

type PlatformProbe = () => { native: boolean; platform: string };
type CuePlayer = (cue: ResolvedHaptic) => Promise<void>;

function defaultProbe(): { native: boolean; platform: string } {
  return {
    native: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
  };
}

async function defaultPlay(cue: ResolvedHaptic): Promise<void> {
  const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
  switch (cue) {
    case "impact-light":
      await Haptics.impact({ style: ImpactStyle.Light });
      return;
    case "notification-success":
      await Haptics.notification({ type: NotificationType.Success });
      return;
    case "notification-error":
      await Haptics.notification({ type: NotificationType.Error });
      return;
    case "selection":
      await Haptics.selectionChanged();
      return;
  }
}

let probe: PlatformProbe = defaultProbe;
let playCue: CuePlayer = defaultPlay;
let nowMs: () => number = () => Date.now();
let lastPulseMs = Number.NEGATIVE_INFINITY;

export function configureHapticsForTests(
  hooks: {
    probe?: PlatformProbe;
    /** Plays every resolved cue. Prefer this over `playImpact`. */
    play?: CuePlayer;
    /** Legacy hook: only the light-impact cue reaches it. */
    playImpact?: () => Promise<void>;
    now?: () => number;
  } | null,
): void {
  probe = hooks?.probe ?? defaultProbe;
  if (hooks?.play) {
    playCue = hooks.play;
  } else if (hooks?.playImpact) {
    const playImpact = hooks.playImpact;
    playCue = async (cue) => {
      if (cue === "impact-light") await playImpact();
    };
  } else {
    playCue = defaultPlay;
  }
  nowMs = hooks?.now ?? (() => Date.now());
  lastPulseMs = Number.NEGATIVE_INFINITY;
}

function currentSurface(): HapticSurface {
  try {
    const reading = probe();
    return hapticSurface(!!reading?.native, String(reading?.platform ?? "web"));
  } catch {
    return "web";
  }
}

function emit(resolved: ResolvedHaptic): void {
  if (hapticCueUsesGap(resolved)) {
    const now = nowMs();
    if (!hapticGapElapsed(now, lastPulseMs)) return;
    lastPulseMs = now;
  }
  try {
    void Promise.resolve(playCue(resolved)).catch(() => {
      // Fail open: haptics must never block the confirmed action.
    });
  } catch {
    // A synchronous plugin failure is the same as an unavailable vibrator.
  }
}

function request(cue: HapticCue): void {
  const resolved = resolveHapticCue(currentSurface(), cue);
  if (resolved) emit(resolved);
}

/** Light impact after a real vote or prediction success. Never throws. */
export function hapticSuccess(): void {
  request("success");
}

/** Error notification after a rejected action. Silent on Android and web. */
export function hapticError(): void {
  request("error");
}

/** Success notification when a streak or Vox reward is shown. iOS only. */
export function hapticNotifySuccess(): void {
  request("notify-success");
}

/** Selection tick for the tab bar and segmented controls. iOS only. */
export function hapticSelection(): void {
  request("selection");
}

/**
 * Kept so older call sites compile. Chrome taps are not confirmations
 * and do not vibrate.
 */
export function haptic(_pattern: number | number[] = 10): void {}
