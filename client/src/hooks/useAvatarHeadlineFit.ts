import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { chooseFontSizeForHeight } from "@/lib/fitFontSize";

/**
 * Find largest font size so wrapped text fits within maxHeightPx.
 * The heading is never clipped: if the final face is wider than the one
 * measured (Android system Roboto, then Inter), a later pass refits, and
 * any leftover overflow stays visible.
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

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el || maxHeightPx <= 0 || maxWidthPx <= 8) return;

    el.textContent = text;
    el.style.width = "100%";
    el.style.maxWidth = "100%";
    el.style.whiteSpace = "normal";
    el.style.wordBreak = "break-word";
    el.style.lineHeight = String(lineHeight);
    // Unclamp while measuring. A previous max-height makes some engines
    // report a clipped scrollHeight and the search then picks too large a font.
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
    if (fontFamily) el.style.fontFamily = fontFamily;

    const contentHeight = () => {
      void el.offsetHeight;
      return Math.max(el.scrollHeight, Math.ceil(el.getBoundingClientRect().height));
    };

    const best = chooseFontSizeForHeight(
      (size) => {
        el.style.fontSize = `${size}px`;
        return contentHeight();
      },
      minFontPx,
      maxFontPx,
      maxHeightPx,
    );

    el.style.fontSize = `${best}px`;
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
    setFontSizePx(best);
  }, [text, maxHeightPx, maxWidthPx, minFontPx, maxFontPx, lineHeight, fontFamily]);

  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let fitting = false;
    let locked = false;
    let scheduled = false;
    const refit = () => {
      if (fitting || locked) return;
      fitting = true;
      try {
        const before = parseFloat(el.style.fontSize || "0");
        fit();
        const after = parseFloat(el.style.fontSize || "0");
        // Search and the live box can disagree by a pixel. If shrinking
        // doesn't stick, keep the extra line instead of looping.
        if (after >= before && el.scrollHeight > maxHeightPx) locked = true;
      } finally {
        fitting = false;
      }
    };

    // Font swap (Roboto fallback → Inter) changes wrapping without changing
    // the column width, so the width ResizeObserver never refits. Once the
    // block is allowed to grow, this observer sees the extra line. Mutating
    // layout inside the callback trips a ResizeObserver loop error, so the
    // refit is deferred to the next frame.
    const ro = new ResizeObserver(() => {
      if (scheduled || locked) return;
      const size = parseFloat(el.style.fontSize || "0");
      if (size <= minFontPx) return;
      if (el.scrollHeight <= maxHeightPx) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        refit();
      });
    });
    ro.observe(el);

    const fonts = document.fonts;
    const onFonts = () => refit();
    fonts?.addEventListener("loadingdone", onFonts);
    if (fonts && fonts.status !== "loaded") {
      void fonts.ready.then(onFonts);
    }

    return () => {
      ro.disconnect();
      fonts?.removeEventListener("loadingdone", onFonts);
    };
  }, [fit, maxHeightPx, minFontPx]);

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
    el.style.textOverflow = "ellipsis";
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
