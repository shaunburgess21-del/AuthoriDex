/**
 * Tiny signal bus so vote/prediction success can reset the hide-hint streak
 * without importing the observer controller (and its query client).
 */

type Listener = () => void;

const voteListeners = new Set<Listener>();

/** A card vote or prediction landed. Clears the "scrolled past without voting" streak. */
export function noteHideHintVote(): void {
  voteListeners.forEach((listener) => listener());
}

export function onHideHintVote(listener: Listener): () => void {
  voteListeners.add(listener);
  return () => {
    voteListeners.delete(listener);
  };
}
