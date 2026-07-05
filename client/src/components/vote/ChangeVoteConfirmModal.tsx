import { lazy, Suspense, type MouseEvent } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markOverlayDismissSuppress } from "@/lib/overlayDismissSuppress";
import { ChangeVoteHeroPlaceholder } from "@/components/vote/ChangeVoteHero";

const ChangeVoteHero = lazy(() =>
  import("@/components/vote/ChangeVoteHero").then((m) => ({
    default: m.ChangeVoteHero,
  })),
);

export interface ChangeVoteConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toOptionName: string;
  fromOptionName?: string;
  onConfirm: () => void | Promise<void>;
  confirmPending?: boolean;
  /** OpinionPollCard uses stopPropagation on content click — preserve via prop. */
  stopPropagation?: boolean;
}

export function ChangeVoteConfirmModal({
  open,
  onOpenChange,
  toOptionName,
  fromOptionName,
  onConfirm,
  confirmPending = false,
  stopPropagation = false,
}: ChangeVoteConfirmModalProps) {
  const handleContentClick = stopPropagation
    ? (e: MouseEvent) => e.stopPropagation()
    : undefined;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      markOverlayDismissSuppress();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay
          className="bg-black/50 backdrop-blur-md"
          onPointerDown={markOverlayDismissSuppress}
        />
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-[80] flex w-[calc(100%-2rem)] max-w-md max-h-[85vh] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          onClick={handleContentClick}
          data-testid="modal-change-vote-confirm"
        >
          <DialogPrimitive.Close
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full opacity-70 ring-offset-background transition-opacity hover:bg-muted/60 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          <div className="flex flex-col px-6 pb-6 pt-4">
            <Suspense
              fallback={
                <ChangeVoteHeroPlaceholder
                  fromOptionName={fromOptionName}
                  toOptionName={toOptionName}
                />
              }
            >
              <ChangeVoteHero
                fromOptionName={fromOptionName}
                toOptionName={toOptionName}
              />
            </Suspense>

            <div className="flex flex-col space-y-2 text-center">
              <DialogTitle className="text-xl font-semibold leading-tight tracking-tight">
                Change your vote?
              </DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                You&apos;re switching to{" "}
                <span className="font-medium text-foreground">{toOptionName}</span>.
                You can change your vote once per day on this poll.
              </DialogDescription>
            </div>

            <div className="mt-5 flex flex-col space-y-2">
              <Button
                type="button"
                size="lg"
                className="min-h-11 w-full bg-cyan-500 hover:bg-cyan-600 text-white border-cyan-600"
                onClick={() => void onConfirm()}
                disabled={confirmPending}
                data-testid="button-change-vote-confirm"
              >
                {confirmPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Changing vote…
                  </>
                ) : (
                  "Change vote"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="min-h-11 w-full"
                onClick={() => onOpenChange(false)}
                disabled={confirmPending}
                data-testid="button-change-vote-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
