import { toast } from "sonner";
import { Link } from "wouter";
import {
  HIDE_CARD_TOAST_DURATION_MS,
  attachHoldPause,
  createDismissCountdown,
} from "@/lib/hide-card-toast-pause";

export const HIDE_CARD_TOAST_TEST_ID = "toast-card-hidden";

/** Where a signed-in user brings a hidden card back. */
export const HIDDEN_CARDS_HREF = "/me/hidden";

/**
 * One stable id so a second hide replaces the Undo target instead of
 * stacking another "Card hidden" card on top of the first.
 */
const HIDE_CARD_TOAST_ID = "vd-card-hidden";

type OpenToast = { cancel: () => void };
let openToast: OpenToast | null = null;

/**
 * Sonner starts a swipe on pointerdown for anything except a button, and
 * that gesture swallows the click. Stop it on the link so a tap navigates.
 */
function keepLinkPress(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

function HiddenCardsToastLink({ onOpen }: { onOpen: () => void }) {
  return (
    <span onClick={onOpen}>
      <Link
        href={HIDDEN_CARDS_HREF}
        data-testid="link-toast-hidden-cards"
        className="whitespace-nowrap underline underline-offset-2 hover:text-foreground"
        onPointerDown={keepLinkPress}
      >
        Me → Hidden cards
      </Link>
    </span>
  );
}

/**
 * "Card hidden" with Undo. Stays for about 6s. The countdown pauses while
 * the pointer hovers the toast or a finger is touching or pressing it, and
 * resumes on leave or release. Sonner's own duration is Infinity so the
 * global 3s default cannot close this card; "Card restored" does not use
 * this helper.
 *
 * The description links to Hidden cards. A click uses wouter, then dismisses
 * this toast.
 */
export function showCardHiddenToast(onUndo: () => void): void {
  openToast?.cancel();

  let detach = () => {};
  let closed = false;
  let countdown: { cancel: () => void; setPaused: (paused: boolean) => void } | null = null;

  const end = (dismiss: boolean) => {
    if (closed) return;
    closed = true;
    if (openToast?.cancel === cancel) openToast = null;
    countdown?.cancel();
    detach();
    if (dismiss) toast.dismiss(HIDE_CARD_TOAST_ID);
  };

  function cancel() {
    end(false);
  }

  countdown = createDismissCountdown({
    durationMs: HIDE_CARD_TOAST_DURATION_MS,
    onFire: () => end(true),
  });

  openToast = { cancel };

  toast("Card hidden", {
    id: HIDE_CARD_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    testId: HIDE_CARD_TOAST_TEST_ID,
    description: <>Unhide anytime in <HiddenCardsToastLink onOpen={() => end(true)} />.</>,
    classNames: {
      actionButton: "hide-card-undo",
    },
    action: {
      label: "Undo",
      onClick: () => {
        end(false);
        onUndo();
      },
    },
    onDismiss: () => end(false),
  });

  let bound = false;
  const bind = () => {
    if (closed || bound || typeof document === "undefined") return;
    const el = document.querySelector(`[data-testid="${HIDE_CARD_TOAST_TEST_ID}"]`);
    if (!el) return;
    bound = true;
    detach = attachHoldPause(el, (paused) => countdown?.setPaused(paused));
  };

  const retry = (attempt: number) => {
    bind();
    if (bound || closed || attempt >= 4) return;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => retry(attempt + 1));
    }
  };

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => retry(0));
  }
  if (typeof window !== "undefined") {
    window.setTimeout(bind, 0);
    window.setTimeout(bind, 50);
  }
}
