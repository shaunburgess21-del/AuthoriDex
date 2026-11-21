"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, Minimize2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ABOVE_DISCUSSION_ATTR,
  DISCUSSION_SCROLLER_SELECTOR,
  DISCUSSION_SHELL_OPEN_ATTR,
  discussionPinStillCurrent,
  discussionShellViewportBox,
  nextDiscussionPinGeneration,
  pointInsideRect,
  shouldRecoverDiscussionPointer,
} from "@/lib/discussionShell";

export interface CommentsFocusShellProps {
  open: boolean;
  onClose: () => void;
  /** Optional subtitle (poll title, person name, …). */
  contextTitle?: string | null;
  children: React.ReactNode;
}

const ABOVE_SHELL_SELECTOR = [
  `[${ABOVE_DISCUSSION_ATTR}]`,
  "[role='alertdialog']",
  "[role='menu']",
  "[data-radix-popper-content-wrapper]",
  "[data-radix-popover-content]",
  "[data-sonner-toaster]",
].join(", ");

function isElementTarget(value: EventTarget | null): value is Element {
  return typeof Element !== "undefined" && value instanceof Element;
}

/** Another dialog, the comment ⋮ sheet, or a toast — they own this tap. */
function targetIsAboveShell(target: EventTarget | null, shell: HTMLElement): boolean {
  if (!isElementTarget(target) || shell.contains(target)) return false;
  const dialog = target.closest("[role='dialog']");
  if (dialog && dialog !== shell) return true;
  return !!target.closest(ABOVE_SHELL_SELECTOR);
}

function snapshotOutsideScrollers(shell: HTMLElement | null): Map<HTMLElement, number> {
  const saved = new Map<HTMLElement, number>();
  const nodes = document.querySelectorAll<HTMLElement>(DISCUSSION_SCROLLER_SELECTOR);
  nodes.forEach((el) => {
    if (shell?.contains(el)) return;
    if (el.closest(`[${ABOVE_DISCUSSION_ATTR}]`)) return;
    saved.set(el, el.scrollTop);
  });
  return saved;
}

/**
 * Full-screen discussion. The shell covers the viewport, so a tap "outside"
 * it is never a real dismiss — on iPhone that tap is the comment field,
 * delivered to the page behind the dialog. Back and the corner button close it.
 */
export function CommentsFocusShell({
  open,
  onClose,
  contextTitle,
  children,
}: CommentsFocusShellProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    if (!open) return;
    const token = nextDiscussionPinGeneration();
    document.documentElement.setAttribute(DISCUSSION_SHELL_OPEN_ATTR, "");

    const savedX = window.scrollX;
    const savedY = window.scrollY;
    const scrollers = snapshotOutsideScrollers(contentRef.current);
    let locking = false;

    const restore = () => {
      if (!discussionPinStillCurrent(token)) return;
      locking = true;
      try {
        if (window.scrollX !== savedX || window.scrollY !== savedY) {
          window.scrollTo(savedX, savedY);
        }
        scrollers.forEach((top, el) => {
          if (el.isConnected && el.scrollTop !== top) el.scrollTop = top;
        });
      } finally {
        locking = false;
      }
    };

    const pinScroll = (event: Event) => {
      if (locking || !discussionPinStillCurrent(token)) return;
      const shell = contentRef.current;
      if (event.target instanceof Node && shell?.contains(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest(`[${ABOVE_DISCUSSION_ATTR}]`)
      ) {
        return;
      }
      restore();
    };

    // iOS hit-tests a textarea in this fixed dialog onto the overlay or the
    // feed. Catch that pointerdown before Radix treats it as an outside tap.
    const recoverPointer = (event: PointerEvent) => {
      const shell = contentRef.current;
      if (!shell || !discussionPinStillCurrent(token)) return;
      const target = event.target;
      const inside = target instanceof Node && shell.contains(target);
      if (
        !shouldRecoverDiscussionPointer({
          targetInsideShell: inside,
          targetAboveShell: targetIsAboveShell(target, shell),
          clientX: event.clientX,
          clientY: event.clientY,
          shellRect: shell.getBoundingClientRect(),
        })
      ) {
        return;
      }
      event.stopPropagation();
      const field = shell.querySelector("textarea, input");
      if (!(field instanceof HTMLElement)) return;
      const rect = field.getBoundingClientRect();
      if (!pointInsideRect(event.clientX, event.clientY, rect, 16)) return;
      field.focus({ preventScroll: true });
    };

    const applyViewport = () => {
      const shell = contentRef.current;
      const vv = window.visualViewport;
      if (!shell || !vv) return;
      const box = discussionShellViewportBox({
        innerHeight: window.innerHeight,
        visualHeight: vv.height,
        offsetTop: vv.offsetTop,
      });
      if (!box) {
        shell.style.top = "";
        shell.style.bottom = "";
        return;
      }
      shell.style.top = `${box.top}px`;
      shell.style.bottom = `${box.bottom}px`;
    };

    // Viewport scroll is dispatched on `window` in some engines and on
    // `document` in others. The event does not bubble, so listen to both.
    window.addEventListener("scroll", pinScroll, true);
    document.addEventListener("scroll", pinScroll, true);
    document.addEventListener("pointerdown", recoverPointer, true);
    window.visualViewport?.addEventListener("resize", applyViewport);
    window.visualViewport?.addEventListener("scroll", applyViewport);
    applyViewport();

    return () => {
      window.removeEventListener("scroll", pinScroll, true);
      document.removeEventListener("scroll", pinScroll, true);
      document.removeEventListener("pointerdown", recoverPointer, true);
      window.visualViewport?.removeEventListener("resize", applyViewport);
      window.visualViewport?.removeEventListener("scroll", applyViewport);
      const shell = contentRef.current;
      if (shell) {
        shell.style.top = "";
        shell.style.bottom = "";
      }
      // The scroll lock comes off after this cleanup. iOS can drop scrollY
      // to 0 a frame later, so keep restoring until that settles, then let
      // the feed follow the finger again.
      const delays = [0, 50, 150, 350];
      delays.forEach((delay, index) => {
        window.setTimeout(() => {
          if (!discussionPinStillCurrent(token)) return;
          const last = index === delays.length - 1;
          // Late ticks only correct the keyboard's jump back to the top.
          // A finger that has already moved the feed stays where it is.
          const jumpedToTop = window.scrollY < 8 && savedY > 8;
          if (!last || jumpedToTop) restore();
          if (last) document.documentElement.removeAttribute(DISCUSSION_SHELL_OPEN_ATTR);
        }, delay);
      });
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (!next) onClose();
    }}
    >
      <DialogPortal>
        <DialogOverlay
          className={cn(
            "z-[70]",
            "bg-background md:bg-black/55",
          )}
        />
        <DialogPrimitive.Content
          ref={contentRef}
          data-discussion-shell=""
          aria-describedby={undefined}
          // Prevent Radix from restoring/moving focus to the trigger (e.g. a
          // button inside a scroll-snap column). That scrollIntoView fights
          // snap-mandatory and can jam Quick Vote / other decks on one card.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // This shell is the whole screen. An "outside" tap on iOS is the
          // comment field (or the feed behind it), not a request to leave.
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          className={cn(
            "fixed inset-0 z-[70] flex min-h-0 flex-col bg-background shadow-none border-0 rounded-none",
            "w-full outline-none overscroll-contain",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        >
          <header className="shrink-0 border-b border-border/60 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div
              className={cn(
                "flex items-center gap-3 py-3 px-4",
                "md:mx-auto md:max-w-3xl md:px-8 lg:max-w-4xl lg:px-12",
              )}
            >
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-10 min-w-10 md:min-w-0"
                aria-label="Back"
              >
                <ArrowLeft className="h-5 w-5 shrink-0" />
                <span className="hidden sm:inline">Back</span>
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <DialogPrimitive.Title className="text-sm font-semibold leading-tight truncate">
                  Discussion
                </DialogPrimitive.Title>
                {contextTitle ? (
                  <p className="text-xs text-muted-foreground truncate">{contextTitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-10 min-w-10"
                aria-label="Exit full screen discussion"
              >
                <Minimize2 className="h-5 w-5" />
              </button>
            </div>
          </header>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden px-1.5",
              "md:mx-auto md:max-w-3xl md:w-full md:px-8 lg:max-w-4xl lg:px-12",
            )}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
