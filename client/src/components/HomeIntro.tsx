import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  HOME_INTRO_COMPACT,
  HOME_INTRO_STEPS,
  HOME_INTRO_STORAGE_KEY,
  HOME_INTRO_TAGLINE,
  homeIntroModeFromStored,
  homeIntroStoredAfterSeen,
  type HomeIntroMode,
} from "@/lib/homeIntro";

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(HOME_INTRO_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string) {
  try {
    window.localStorage.setItem(HOME_INTRO_STORAGE_KEY, value);
  } catch {
    /* private browsing */
  }
}

/**
 * First-visit explanation above the home leaderboard.
 * Full card once, a single line on later visits, gone after dismiss.
 */
export function HomeIntro() {
  const [mode, setMode] = useState<HomeIntroMode>(() => homeIntroModeFromStored(readStored()));

  useEffect(() => {
    if (mode !== "full") return;
    writeStored(homeIntroStoredAfterSeen(readStored()));
  }, [mode]);

  if (mode === "hidden") return null;

  const dismiss = () => {
    writeStored("hidden");
    setMode("hidden");
  };

  if (mode === "compact") {
    return (
      <div
        className="mb-3 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
        data-testid="home-intro-compact"
      >
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{HOME_INTRO_COMPACT}</p>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss introduction"
          data-testid="button-dismiss-home-intro"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <section
      className="mb-4 rounded-xl border border-border/70 bg-card/80 px-4 py-3"
      data-testid="home-intro"
      aria-label="What VoxDex is"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base font-semibold leading-snug sm:text-lg">{HOME_INTRO_TAGLINE}</p>
          <ol className="mt-2 grid gap-1.5 sm:grid-cols-3 sm:gap-3">
            {HOME_INTRO_STEPS.map((step, index) => (
              <li key={step.title} className="flex items-baseline gap-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                <span>
                  <span className="font-medium">{step.title}</span>
                  <span className="text-muted-foreground"> — {step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss introduction"
          data-testid="button-dismiss-home-intro"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
