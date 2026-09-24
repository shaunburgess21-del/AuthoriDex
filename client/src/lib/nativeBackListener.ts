import { App } from "@capacitor/app";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { decideNativeBack } from "@/lib/nativeBack";

/**
 * Survives Vite re-evaluating this module. `import.meta.hot.dispose` drops
 * the native listener; the generation token drops a handle that resolves
 * after that cleanup so HMR cannot stack duplicate `backButton` handlers.
 * `App.removeAllListeners()` is never used — that would also remove the
 * native OAuth `appUrlOpen` listener.
 */
const SLOT_KEY = "__voxdexAndroidBack";

interface BackSlot {
  handle: PluginListenerHandle | null;
  pending: boolean;
  generation: number;
}

function backSlot(): BackSlot {
  const g = globalThis as typeof globalThis & { [SLOT_KEY]?: BackSlot };
  if (!g[SLOT_KEY]) {
    g[SLOT_KEY] = { handle: null, pending: false, generation: 0 };
  }
  return g[SLOT_KEY];
}

function performNativeBack(canGoBack: boolean): void {
  const decision = decideNativeBack(window.location.pathname, canGoBack);
  if (decision.type === "back") {
    window.history.back();
    return;
  }
  if (decision.type === "exit") {
    void App.exitApp();
    return;
  }
  // Replace, don't push. A push would make the next Back return to the
  // deep link and bounce forever. Wouter patches `replaceState` and
  // re-renders the matched route.
  window.history.replaceState(null, "", decision.path);
}

export function removeNativeBackListener(): void {
  const slot = backSlot();
  slot.generation += 1;
  slot.pending = false;
  const handle = slot.handle;
  slot.handle = null;
  if (handle) void handle.remove();
}

/** Android only. Web and iOS return immediately so their Back behaviour stays untouched. */
export function installNativeBackListener(): void {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

  const slot = backSlot();
  if (slot.handle || slot.pending) return;

  const generation = slot.generation + 1;
  slot.generation = generation;
  slot.pending = true;

  void App.addListener("backButton", ({ canGoBack }) => {
    performNativeBack(canGoBack);
  })
    .then((handle) => {
      const current = backSlot();
      if (current.generation !== generation) {
        void handle.remove();
        return;
      }
      current.handle = handle;
      current.pending = false;
    })
    .catch(() => {
      const current = backSlot();
      if (current.generation === generation) current.pending = false;
    });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    removeNativeBackListener();
  });
}

// Idempotent. main.tsx also calls this next to the OAuth listener so the
// startup site stays obvious. Re-evaluating this module after HMR dispose
// registers a fresh listener even when main.tsx itself did not re-run.
installNativeBackListener();
