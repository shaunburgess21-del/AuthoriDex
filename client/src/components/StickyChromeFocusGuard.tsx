import { useEffect } from "react";
import { bindStickyChromeFocusGuard } from "@/lib/stickyChromeFocus";

/** Keeps the sticky chip bar from staying focused under an open overlay. */
export function StickyChromeFocusGuard() {
  useEffect(() => bindStickyChromeFocusGuard(document), []);
  return null;
}
