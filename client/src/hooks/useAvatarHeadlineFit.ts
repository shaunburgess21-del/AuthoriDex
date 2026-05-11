import { useLayoutEffect, useRef, useState } from "react";

/**
 * Find largest font size so wrapped text fits within maxHeightPx (up to natural line wraps).
 */
export function useFitTextBlockToHeight({
  text,
  maxHeightPx,
  maxWidthPx,
  minFontPx = 11,
  maxFontPx: maxFontPxProp,
  lineHeight = 1.2,
  fontFamily,
}: {
  text: string;
  maxHeightPx: number;
  maxWidthPx: number;
  minFontPx?: number;
  maxFontPx?: number;
  lineHeight?: number;
  fontFamily?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [fontSizePx, setFontSizePx] = useState(18);

  const defaultMax = maxHeightPx > 0 ? Math.min(40, Math.max(minFontPx, Math.floor(maxHeightPx / 2))) : 28;
  const maxFontPx = maxFontPxProp ?? defaultMax;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || maxHeightPx <= 0 || maxWidthPx <= 8) return;

    el.textContent = text;
    el.style.width = "100%";
    el.style.maxWidth = "100%";
    el.style.whiteSpace = "normal";
    el.style.wordBreak = "break-word";
    el.style.overflow = "hidden";
    el.style.maxHeight = `${maxHeightPx}px`;
    el.style.lineHeight = String(lineHeight);
    if (fontFamily) el.style.fontFamily = fontFamily;

    let lo = minFontPx;
    let hi = Math.max(lo, maxFontPx);
    let best = lo;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;
      const sh = el.scrollHeight;
      if (sh <= maxHeightPx) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    el.style.fontSize = `${best}px`;
    setFontSizePx(best);
  }, [text, maxHeightPx, maxWidthPx, minFontPx, maxFontPx, lineHeight, fontFamily]);

  return { ref, fontSizePx };
}

/**
 * Single line: shrink font until text fits container width (nowrap).
 */
export function useFitSingleLineToWidth({
  text,
  maxWidthPx,
  minFontPx = 12,
  maxFontPx = 28,
  fontWeight = 600,
}: {
  text: string;
  maxWidthPx: number;
  minFontPx?: number;
  maxFontPx?: number;
  fontWeight?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [fontSizePx, setFontSizePx] = useState(maxFontPx);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || maxWidthPx <= 8) return;

    el.textContent = text;
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "hidden";
    el.style.width = "100%";
    el.style.maxWidth = "100%";
    el.style.fontWeight = String(fontWeight);

    let lo = minFontPx;
    let hi = maxFontPx;
    let best = lo;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      el.style.fontSize = `${mid}px`;
      if (el.scrollWidth <= maxWidthPx) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    el.style.fontSize = `${best}px`;
    setFontSizePx(best);
  }, [text, maxWidthPx, minFontPx, maxFontPx, fontWeight]);

  return { ref, fontSizePx };
}
