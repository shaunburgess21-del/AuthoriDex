import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";
import { isStablePress } from "@/lib/stable-press";

/**
 * Fires `onPress` on the first pointerup that stays within a small slop,
 * and swallows the follow-up click so the action cannot run twice.
 * Pointer capture keeps the gesture if a parent hover transform moves the
 * button before click would have fired.
 */
export function useStablePress(onPress: () => void) {
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const firedRef = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    startRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    firedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!isStablePress(start, { x: event.clientX, y: event.clientY })) return;
    firedRef.current = true;
    event.preventDefault();
    event.stopPropagation();
    onPress();
  }, [onPress]);

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
  }, []);

  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    onPress();
  }, [onPress]);

  return { onPointerDown, onPointerUp, onPointerCancel, onClick };
}
