import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useFitSingleLineToWidth } from "@/hooks/useAvatarHeadlineFit";

/** Single-line person name that shrinks to fit the measured column width (Weekly Up/Down cards). */
export function WeeklyUpDownNameBlock({ text, className = "" }: { text: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w > 0) setWidth(w);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, text]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const safeW = width > 0 ? width : 280;
  const { ref, fontSizePx } = useFitSingleLineToWidth({
    text,
    maxWidthPx: safeW,
    minFontPx: 12,
    maxFontPx: 22,
    fontWeight: 600,
  });

  return (
    <div ref={wrapRef} className={`min-w-0 w-full ${className}`}>
      <p ref={ref} className="font-semibold leading-tight" style={{ fontSize: fontSizePx }}>
        {text}
      </p>
    </div>
  );
}
