/**
 * Site guide. A glass pill at the top of the bottom-right corner stack
 * (above Quick Vote and the activity-filter eye) on every public page.
 * Opens a short chat grounded on the server-side How it works articles.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowUp, MessageCircle, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVisualViewportOffset } from "@/hooks/useVisualViewportOffset";
import { KEYBOARD_OBSCURE_THRESHOLD_PX } from "@/lib/nativeKeyboard";
import { cn } from "@/lib/utils";
import { helpFabStackPx, useCornerFabOffset } from "@/components/help-chat/placement";
import { HelpRichText } from "@/components/help-chat/HelpRichText";
import { friendlyHelpError } from "@/lib/helpChatFormat";
import { useCornerPillIntro } from "@/lib/cornerPillIntro";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_SUGGESTIONS = [
  "How does the ranking work?",
  "How do I earn Vox?",
  "What happens when I predict?",
];

/** Chips that match where the member opened the panel. */
function suggestionsForPath(pathname: string): string[] {
  if (pathname === "/" || pathname === "/vote" || pathname.startsWith("/vote/")) {
    return [
      "What can I vote on here?",
      "Does voting cost Vox?",
      "What is Quick Vote?",
    ];
  }
  if (pathname === "/predict" || pathname.startsWith("/predict/")) {
    return [
      "How do prediction markets work?",
      "When does the Weekly Jackpot close?",
      "Can I sell a position early?",
    ];
  }
  if (pathname === "/voices" || pathname.startsWith("/voices/")) {
    return [
      "What is Voices?",
      "How do I earn XP for posting?",
      "How do I earn Vox?",
    ];
  }
  if (pathname === "/insights" || pathname.startsWith("/insights/")) {
    return [
      "What is Insights vs Rankings?",
      "What is Trend Score?",
      "How does approval rating work?",
    ];
  }
  if (pathname === "/me" || pathname.startsWith("/me/")) {
    return [
      "Where do I see my Vox balance?",
      "How do ranks work?",
      "How do I earn more Vox?",
    ];
  }
  if (pathname === "/how-it-works" || pathname.startsWith("/how-it-works")) {
    return [
      "Summarize how predicting works",
      "How do I earn XP?",
      "What is the difference between XP and Vox?",
    ];
  }
  if (
    pathname === "/rankings" ||
    pathname === "/leaderboard" ||
    pathname.startsWith("/person/") ||
    pathname.startsWith("/celebrity/")
  ) {
    return [
      "How does the ranking work?",
      "What are Daily Movers?",
      "How do Favorites work?",
    ];
  }
  return DEFAULT_SUGGESTIONS;
}

/** Matches the server: the last 8 turns, questions up to 500 characters. */
const MAX_SENT_TURNS = 8;
const MAX_QUESTION_CHARS = 500;

/** Gap between the panel and the top of the on-screen keyboard. */
const KEYBOARD_GAP_PX = 8;

const FAB_CLASS =
  "pointer-events-auto flex items-center rounded-full border border-white/15 bg-black/30 p-2.5 text-sm font-medium text-slate-100 shadow-2xl shadow-black/40 backdrop-blur-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50";

function hideOnThisRoute(location: string): boolean {
  return (
    location === "/login" ||
    location.startsWith("/login/") ||
    location === "/admin" ||
    location.startsWith("/admin/")
  );
}

/**
 * Where the panel sits while the on-screen keyboard covers the bottom of
 * the page (iOS Safari, Chrome Android). `useVisualViewportOffset` goes to
 * 0 for the keyboard on purpose — the bottom nav should stay behind it —
 * so the panel tracks the visible area itself. Null when no keyboard.
 */
function useKeyboardPanelBox(enabled: boolean): { bottom: number; maxHeight: number } | null {
  const [box, setBox] = useState<{ bottom: number; maxHeight: number } | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!enabled || !vv) {
      setBox(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (window.innerHeight - vv.height <= KEYBOARD_OBSCURE_THRESHOLD_PX) {
        setBox((prev) => (prev === null ? prev : null));
        return;
      }
      const below = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
      const next = {
        bottom: below + KEYBOARD_GAP_PX,
        maxHeight: Math.max(160, Math.round(vv.height) - KEYBOARD_GAP_PX * 2),
      };
      setBox((prev) =>
        prev && prev.bottom === next.bottom && prev.maxHeight === next.maxHeight ? prev : next,
      );
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return box;
}

export function HelpChat() {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const viewportOffset = useVisualViewportOffset();
  const cornerStack = useCornerFabOffset();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const hidden = hideOnThisRoute(location);
  const labelVisible = useCornerPillIntro("help-chat", !hidden);
  const keyboardBox = useKeyboardPanelBox(open && isMobile);

  const suggestions = suggestionsForPath(location);
  const ask = useMutation({
    mutationFn: async (messages: ChatTurn[]) => {
      const res = await apiRequest("POST", "/api/help/chat", {
        messages,
        pagePath: location,
      });
      const body = (await res.json()) as { data?: { reply?: string } };
      const reply = body.data?.reply?.trim();
      if (!reply) throw new Error("The help chat sent an empty answer.");
      return reply;
    },
  });
  const pending = ask.isPending;

  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--fab-stack", `${helpFabStackPx(cornerStack)}px`);
    return () => {
      document.documentElement.style.removeProperty("--fab-stack");
    };
  }, [cornerStack]);

  const lastLocation = useRef(location);
  useEffect(() => {
    if (lastLocation.current === location) return;
    lastLocation.current = location;
    setOpen(false);
  }, [location]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pending, open, error, keyboardBox]);

  function send(text: string) {
    const question = text.trim().slice(0, MAX_QUESTION_CHARS);
    if (!question || pending) return;
    const next: ChatTurn[] = [...turns, { role: "user", content: question }];
    setTurns(next);
    setDraft("");
    setError(null);
    ask.mutate(next.slice(-MAX_SENT_TURNS), {
      onSuccess: (reply) => {
        setTurns((current) => [...current, { role: "assistant", content: reply }]);
      },
      onError: (err) => {
        // Put the question back so a retry is one tap and the transcript has no orphan turn.
        setTurns((current) => current.slice(0, -1));
        setDraft(question);
        setError(friendlyHelpError(err));
      },
    });
  }

  function startOver() {
    if (pending) return;
    ask.reset();
    setTurns([]);
    setDraft("");
    setError(null);
    if (!isMobile) inputRef.current?.focus();
  }

  if (hidden) return null;

  const fabShift =
    viewportOffset !== 0
      ? { transform: `translateY(${viewportOffset}px)`, willChange: "transform" as const }
      : undefined;
  const panelStyle = keyboardBox
    ? { bottom: keyboardBox.bottom, maxHeight: keyboardBox.maxHeight }
    : fabShift;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* z-40: under every dialog, drawer, and sheet (z-50+), so the pill
          never floats over another modal. */}
      <div
        className="pointer-events-none fixed right-4 z-40 bottom-[calc(5rem+env(safe-area-inset-bottom,0px)+var(--fab-stack,0px))] md:bottom-[calc(1.5rem+var(--fab-stack,0px))]"
        style={fabShift}
        data-android-keyboard-hide=""
      >
        <DialogTrigger asChild>
          <motion.button
            type="button"
            initial={false}
            animate={{ opacity: labelVisible || open ? 1 : 0.5 }}
            transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
            className={FAB_CLASS}
            aria-label="Ask about VoxDex"
            data-testid="help-chat-fab"
          >
            <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
            <motion.span
              initial={false}
              animate={
                labelVisible
                  ? { width: "auto", opacity: 1, marginLeft: 6, marginRight: 4 }
                  : { width: 0, opacity: 0, marginLeft: 0, marginRight: 0 }
              }
              transition={{ duration: labelVisible ? 0.2 : 0.45, ease: "easeOut" }}
              className="overflow-hidden whitespace-nowrap leading-4"
              aria-hidden
            >
              Ask VoxDex
            </motion.span>
          </motion.button>
        </DialogTrigger>
      </div>

      <DialogPortal>
        <DialogOverlay className="z-[60] bg-black/40" />
        <DialogPrimitive.Content
          ref={contentRef}
          tabIndex={-1}
          data-testid="help-chat-panel"
          data-help-chat-panel=""
          style={panelStyle}
          onOpenAutoFocus={(event) => {
            // On a phone the keyboard would cover the suggestions, so focus the
            // panel and let the member tap the field when they are ready.
            event.preventDefault();
            (isMobile ? contentRef.current : inputRef.current)?.focus();
          }}
          className={cn(
            "fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl outline-none",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "origin-bottom-right left-3 right-3 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] max-h-[min(32rem,calc(100dvh-8rem))]",
            "md:left-auto md:right-4 md:bottom-6 md:w-[22.5rem]",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <MessageCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm font-semibold leading-tight tracking-normal">
                Ask VoxDex
              </DialogTitle>
              <DialogDescription className="text-[11px] leading-tight text-muted-foreground">
                How the site works
              </DialogDescription>
            </div>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={startOver}
                disabled={pending}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                aria-label="Start over"
                title="Start over"
                data-testid="help-chat-reset"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            <DialogPrimitive.Close
              className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close"
              data-testid="help-chat-close"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div
            ref={scrollerRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3"
          >
            {turns.length === 0 && !pending && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Ask how ranking, voting, Vox, or predictions work. Answers come from the site guide.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                      data-testid="help-chat-suggestion"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, index) => (
              <div
                key={`${turn.role}-${index}`}
                className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                    turn.role === "user"
                      ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {turn.role === "assistant" ? (
                    <HelpRichText text={turn.content} onNavigate={() => setOpen(false)} />
                  ) : (
                    turn.content
                  )}
                </div>
              </div>
            ))}

            {pending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                  Thinking…
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-destructive" role="alert" data-testid="help-chat-error">
                {error}
              </p>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-2"
            data-keyboard-keep=""
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              maxLength={MAX_QUESTION_CHARS}
              readOnly={pending}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              placeholder="Ask a question"
              aria-label="Ask a question"
              autoComplete="off"
              enterKeyHint="send"
              data-testid="help-chat-input"
              className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-2 text-base outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            />
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Send"
              data-testid="help-chat-send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
