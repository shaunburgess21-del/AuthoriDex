/**
 * Bottom-right floating controls stack upward on the right edge. Anything
 * that occupies the bottom row (Quick Vote, the vote/predict eye, the
 * centered first-visit pills) renders inside a CornerFabSlot; the help
 * button sits one gap above the total height of those slots.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

const GAP_PX = 8;

const heights = new Map<string, number>();
let total = 0;
const listeners = new Set<() => void>();

function publishTotal() {
  let next = 0;
  for (const value of heights.values()) next += value;
  if (next === total) return;
  total = next;
  for (const listener of listeners) listener();
}

function setSlotHeight(id: string, height: number) {
  const next = height > 0 ? height : 0;
  if ((heights.get(id) ?? 0) === next) return;
  if (next === 0) heights.delete(id);
  else heights.set(id, next);
  publishTotal();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pixels already occupied in the bottom-right corner, not counting the gap above them. */
export function useCornerFabOffset(): number {
  return useSyncExternalStore(subscribe, () => total, () => 0);
}

/** Extra bottom offset for the help button: the corner stack plus one gap, or nothing. */
export function helpFabStackPx(cornerPx: number): number {
  return cornerPx > 0 ? cornerPx + GAP_PX : 0;
}

/** Fixed bottom-row wrapper whose rendered height lifts the help button. */
export function CornerFabSlot({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () => setSlotHeight(id, Math.ceil(node.getBoundingClientRect().height));
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      setSlotHeight(id, 0);
    };
  }, [id]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
