/**
 * Quick Vote debug HUD (`?qvdebug=1`). Small fixed monospace panel showing
 * the live state of the snap column plus Copy log / Clear buttons, so an
 * iPhone can report exactly what the scroller is doing when the deck jams.
 * Never rendered without the flag — see lib/quickVoteDebug.ts.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  qvLogClear,
  qvLogEntries,
  qvLogSubscribe,
  qvLogToText,
  qvState,
} from "@/lib/quickVoteDebug";

const POLL_MS = 100;

interface Gauges {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  nearestIdx: number;
  delta: number;
  snapType: string;
  found: boolean;
}

function readColumn(): Gauges {
  const el = document.querySelector<HTMLElement>("[data-qv-column]");
  if (!el) {
    return { scrollTop: 0, clientHeight: 0, scrollHeight: 0, nearestIdx: -1, delta: 0, snapType: "-", found: false };
  }
  const base = el.getBoundingClientRect().top;
  const top = el.scrollTop;
  let nearestIdx = -1;
  let best = Number.POSITIVE_INFINITY;
  let i = 0;
  for (const child of Array.from(el.children)) {
    if (child instanceof HTMLElement) {
      const off = child.getBoundingClientRect().top - base + top;
      const d = Math.abs(off - top);
      if (d < best) {
        best = d;
        nearestIdx = i;
      }
    }
    i += 1;
  }
  return {
    scrollTop: Math.round(top * 10) / 10,
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    nearestIdx,
    delta: Number.isFinite(best) ? Math.round(best * 10) / 10 : 0,
    snapType: el.style.scrollSnapType || "(css)",
    found: true,
  };
}

export function QuickVoteDebugHud() {
  const { user } = useAuth();
  const [gauges, setGauges] = useState<Gauges>(() => readColumn());
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setGauges(readColumn()), POLL_MS);
    const unsub = qvLogSubscribe(() => setTick((n) => n + 1));
    return () => {
      window.clearInterval(id);
      unsub();
    };
  }, []);

  const copy = async () => {
    const text = qvLogToText();
    try {
      await navigator.clipboard.writeText(text);
      toast("Debug log copied", { description: `${qvLogEntries().length} events` });
    } catch {
      // Clipboard API blocked: fall back to a selectable textarea prompt.
      window.prompt("Copy the log:", text);
    }
  };

  const entries = qvLogEntries();
  const last = entries.slice(-6);
  const s = qvState;

  return (
    <div
      className="pointer-events-none fixed left-1 top-[calc(56px+env(safe-area-inset-top,0px))] z-[80] w-[228px] rounded-md bg-black/80 p-1.5 font-mono text-[10px] leading-[13px] text-lime-300 ring-1 ring-white/20"
      data-testid="qv-debug-hud"
    >
      <div>
        {String(s.engine ?? "snap")} {gauges.found ? "ok" : "MISSING"} h={gauges.clientHeight}
        {s.engine === "deck" ? ` y=${String(s.deckY ?? 0)}` : ` sh=${gauges.scrollHeight}`}
      </div>
      {s.engine !== "deck" && (
        <div>
          top={gauges.scrollTop} near={gauges.nearestIdx} d={gauges.delta}
        </div>
      )}
      <div>
        idx={String(s.committedIdx ?? "-")} pend={String(s.pendingIdx ?? "-")} snap={gauges.snapType}
      </div>
      <div>
        touch={String(s.touchActive ?? "-")} tween={String(s.tweenActive ?? "-")} grace=
        {String(s.graceMs ?? "-")}
      </div>
      <div>
        corr={String(s.corrections ?? 0)} ro={String(s.resizeChanges ?? 0)} items=
        {String(s.itemsChanges ?? 0)} rend={String(s.renders ?? 0)}
      </div>
      <div className="truncate">
        card={String(s.cardType ?? "-")} {String(s.cardTitle ?? "")}
      </div>
      <div>auth={user ? "in" : "anon"} n={entries.length}</div>
      <div className="mt-1 max-h-[80px] overflow-hidden text-white/70">
        {last.map((e, i) => (
          <div key={`${e.t}-${i}`} className="truncate">
            {e.t} {e.kind} {e.data ? JSON.stringify(e.data) : ""}
          </div>
        ))}
      </div>
      <div className="pointer-events-auto mt-1 flex gap-1">
        <button
          type="button"
          data-interactive="true"
          onClick={copy}
          className="rounded bg-lime-400/20 px-2 py-1 text-lime-200 ring-1 ring-lime-300/40"
        >
          Copy log
        </button>
        <button
          type="button"
          data-interactive="true"
          onClick={() => qvLogClear()}
          className="rounded bg-white/10 px-2 py-1 text-white/80 ring-1 ring-white/20"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
