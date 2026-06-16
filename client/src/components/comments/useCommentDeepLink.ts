import { useCallback, useEffect, useRef, useState } from "react";

export interface CommentDeepLink {
  /** Id of the comment/insight currently highlighted (deep link or just-posted). */
  highlightedId: string | null;
  /** Programmatically scroll to and highlight a comment (e.g. after posting). */
  highlight: (id: string) => void;
}

/**
 * Scrolls to and briefly highlights the comment/insight referenced by the URL
 * hash (e.g. `#comment-<id>` from a shared link or notification), and exposes a
 * `highlight(id)` trigger for programmatic use (e.g. after a successful post).
 *
 * Robust to surface mismatch: the row element may be rendered as either
 * `comment-<id>` (CommentRow) or `insight-<id>` (InsightCard), so both are tried.
 */
export function useCommentDeepLink(ready: boolean): CommentDeepLink {
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const handledRef = useRef<string | null>(null);

  const highlight = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const el =
        document.getElementById(`comment-${id}`) ??
        document.getElementById(`insight-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(id);
      window.setTimeout(
        () => setHighlightedId((current) => (current === id ? null : current)),
        2200,
      );
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    const match = window.location.hash.match(/^#(?:comment|insight)-(.+)$/);
    if (!match) return;
    const id = match[1];
    if (handledRef.current === id) return;
    handledRef.current = id;
    highlight(id);
  }, [ready, highlight]);

  return { highlightedId, highlight };
}
