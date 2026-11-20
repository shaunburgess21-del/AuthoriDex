/**
 * One shared intro for the bottom-right corner pills (Quick Vote, the
 * vote/predict eye, Ask VoxDex). A pill that has not introduced itself
 * this session asks for an intro; requests that arrive while a page is
 * still mounting are batched, then every pill on screen expands its label
 * together and collapses together. Pills already introduced only expand
 * when a newcomer triggers a fresh intro, so the corner always moves as
 * one. State lives in sessionStorage so a page change or reload mid-intro
 * finishes the same intro instead of restarting it.
 */
import { useEffect, useSyncExternalStore } from "react";

export const CORNER_INTRO_MS = 3000;
/** Wait for pills that mount a moment later (lazy pages, auth, viewport checks). */
export const CORNER_INTRO_SETTLE_MS = 400;
/** Never hold an intro back longer than this after the first request. */
export const CORNER_INTRO_SETTLE_CAP_MS = 2000;
/** A pill that arrives mid-intro gets at least this long before everyone collapses. */
export const CORNER_INTRO_MIN_JOIN_MS = 1200;

const STORAGE_KEY = "voxdex_corner_pill_intro";

interface PersistedIntro {
  introduced: string[];
  endsAt: number;
}

export interface CornerIntroDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  load: () => PersistedIntro | null;
  save: (state: PersistedIntro) => void;
}

export interface CornerIntroCoordinator {
  /** Pill is on screen. Returns the matching unregister. */
  register: (id: string) => () => void;
  isShowing: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createCornerIntroCoordinator(deps: CornerIntroDeps): CornerIntroCoordinator {
  const saved = deps.load();
  const introduced = new Set<string>(saved?.introduced ?? []);
  const mounted = new Map<string, number>();
  const pending = new Set<string>();
  const listeners = new Set<() => void>();

  let endsAt = saved?.endsAt ?? 0;
  let showing = endsAt > deps.now();
  let endTimer: unknown = null;
  let startTimer: unknown = null;
  let firstRequestAt: number | null = null;

  const persist = () => deps.save({ introduced: [...introduced], endsAt });
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const scheduleEnd = () => {
    if (endTimer != null) deps.clearTimer(endTimer);
    endTimer = deps.setTimer(() => {
      endTimer = null;
      showing = false;
      notify();
    }, Math.max(0, endsAt - deps.now()));
  };

  if (showing) scheduleEnd();

  const start = () => {
    startTimer = null;
    firstRequestAt = null;
    if (pending.size === 0) return;
    for (const id of pending) introduced.add(id);
    pending.clear();
    endsAt = deps.now() + CORNER_INTRO_MS;
    showing = true;
    persist();
    scheduleEnd();
    notify();
  };

  const requestIntro = (id: string) => {
    const now = deps.now();
    if (showing) {
      introduced.add(id);
      endsAt = Math.max(endsAt, now + CORNER_INTRO_MIN_JOIN_MS);
      persist();
      scheduleEnd();
      return;
    }
    pending.add(id);
    if (firstRequestAt == null) firstRequestAt = now;
    const startAt = Math.min(now + CORNER_INTRO_SETTLE_MS, firstRequestAt + CORNER_INTRO_SETTLE_CAP_MS);
    if (startTimer != null) deps.clearTimer(startTimer);
    startTimer = deps.setTimer(start, Math.max(0, startAt - now));
  };

  return {
    register(id) {
      mounted.set(id, (mounted.get(id) ?? 0) + 1);
      if (!introduced.has(id)) requestIntro(id);
      return () => {
        const count = (mounted.get(id) ?? 1) - 1;
        if (count > 0) {
          mounted.set(id, count);
          return;
        }
        mounted.delete(id);
        pending.delete(id);
      };
    },
    isShowing: () => showing,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function loadIntro(): PersistedIntro | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedIntro>;
    return {
      introduced: Array.isArray(parsed.introduced) ? parsed.introduced.filter((v) => typeof v === "string") : [],
      endsAt: typeof parsed.endsAt === "number" && Number.isFinite(parsed.endsAt) ? parsed.endsAt : 0,
    };
  } catch {
    return null;
  }
}

function saveIntro(state: PersistedIntro): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode — the intro still plays, it just is not shared across pages.
  }
}

let coordinator: CornerIntroCoordinator | null = null;

function getCoordinator(): CornerIntroCoordinator {
  coordinator ??= createCornerIntroCoordinator({
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
    load: loadIntro,
    save: saveIntro,
  });
  return coordinator;
}

const subscribe = (listener: () => void) => getCoordinator().subscribe(listener);
const getShowing = () => getCoordinator().isShowing();
const getServerShowing = () => false;

/** True while the shared corner intro is playing and this pill is on screen. */
export function useCornerPillIntro(id: string, onScreen: boolean): boolean {
  const showing = useSyncExternalStore(subscribe, getShowing, getServerShowing);
  useEffect(() => {
    if (!onScreen) return;
    return getCoordinator().register(id);
  }, [id, onScreen]);
  return onScreen && showing;
}
