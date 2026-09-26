/**
 * Subtle haptic confirmation for the Capacitor Android shell.
 *
 * Web, PWA, and iOS no-op. The Web Vibration API is not used, so a
 * browser never buzzes. Android plays one short ImpactStyle.Light
 * pulse after a confirmed success, and swallows plugin failures so a
 * missing vibrator cannot block the vote or trade.
 *
 * Errors, rejected picks, search jumps, and filter toggles stay
 * silent. A short gap collapses stacked or rapid calls into one pulse.
 */
import { Capacitor } from "@capacitor/core";

export const HAPTIC_SUCCESS_GAP_MS = 450;

export type HapticSurface = "android" | "ios" | "web";
export type HapticCue = "success" | "error" | "tap";

export function hapticSurface(native: boolean, platform: string): HapticSurface {
  if (native && platform === "android") return "android";
  if (native && platform === "ios") return "ios";
  return "web";
}

/** Success on Android is the only cue that plays. Everything else is silent. */
export function resolveHapticCue(
  surface: HapticSurface,
  cue: HapticCue,
): "impact-light" | null {
  if (surface !== "android" || cue !== "success") return null;
  return "impact-light";
}

/** True when enough time has passed to allow another success pulse. */
export function hapticGapElapsed(
  nowMs: number,
  lastPulseMs: number,
  gapMs = HAPTIC_SUCCESS_GAP_MS,
): boolean {
  return nowMs - lastPulseMs >= gapMs;
}

type PlatformProbe = () => { native: boolean; platform: string };
type ImpactPlayer = () => Promise<void>;

function defaultProbe(): { native: boolean; platform: string } {
  return {
    native: Capacitor.isNativePlatform(),
    platform: Capacitor.getPlatform(),
  };
}

async function defaultPlayImpact(): Promise<void> {
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  await Haptics.impact({ style: ImpactStyle.Light });
}

let probe: PlatformProbe = defaultProbe;
let playImpact: ImpactPlayer = defaultPlayImpact;
let nowMs: () => number = () => Date.now();
let lastPulseMs = Number.NEGATIVE_INFINITY;

export function configureHapticsForTests(
  hooks: {
    probe?: PlatformProbe;
    playImpact?: ImpactPlayer;
    now?: () => number;
  } | null,
): void {
  probe = hooks?.probe ?? defaultProbe;
  playImpact = hooks?.playImpact ?? defaultPlayImpact;
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

/**
 * One light impact after a real success. No-ops off Android and when
 * another pulse landed inside the gap. Never throws.
 */
export function hapticSuccess(): void {
  if (resolveHapticCue(currentSurface(), "success") == null) return;
  const now = nowMs();
  if (!hapticGapElapsed(now, lastPulseMs)) return;
  lastPulseMs = now;
  try {
    void Promise.resolve(playImpact()).catch(() => {
      // Fail open: haptics must never block the confirmed action.
    });
  } catch {
    // A synchronous plugin failure is the same as an unavailable vibrator.
  }
}

/** Failed and rejected actions stay silent on every platform. */
export function hapticError(): void {}

/**
 * Kept so older call sites compile. Chrome taps, search jumps, and
 * filter toggles are not confirmations and do not vibrate.
 */
export function haptic(_pattern: number | number[] = 10): void {}
