"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowLeft, Minimize2 } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface CommentsFocusShellProps {
  open: boolean;
  onClose: () => void;
  /** Optional subtitle (poll title, person name, …). */
  contextTitle?: string | null;
  children: React.ReactNode;
}

export function CommentsFocusShell({
  open,
  onClose,
  contextTitle,
  children,
}: CommentsFocusShellProps) {
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
          aria-describedby={undefined}
          // Prevent Radix from restoring/moving focus to the trigger (e.g. a
          // button inside a scroll-snap column). That scrollIntoView fights
          // snap-mandatory and can jam Quick Vote / other decks on one card.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-0 z-[70] flex flex-col bg-background shadow-none border-0 rounded-none",
            "max-h-[100dvh] w-full outline-none overflow-hidden",
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
