/**
 * The ⋮ sheet is portaled to `document.body`, but React still bubbles the
 * click through the component tree. Voices post overlays close on that
 * bubbled click (`onClick={onClose}` on the backdrop). Choosing Delete set
 * the confirm-dialog flag and then the same click unmounted the overlay, so
 * the dialog never appeared and no DELETE was sent.
 */
export function containPortaledSheetEvent(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

/** Stop the sheet click, then run Delete (open the confirm dialog). */
export function runCommentDeleteAction(
  event: { stopPropagation: () => void },
  onDelete: (() => void) | undefined,
): void {
  containPortaledSheetEvent(event);
  onDelete?.();
}
