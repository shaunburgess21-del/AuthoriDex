import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { useFitTextBlockToHeight } from "@/hooks/useAvatarHeadlineFit";

type AvatarHeightHeadlineProps = {
  text: string;
  avatar: ReactNode;
  className?: string;
  titleClassName?: string;
  href?: string;
  /** When set, headline acts as a button (e.g. Vote page detail with list context). */
  onTitleNavigate?: () => void;
  linkTestId?: string;
  serif?: boolean;
  /** Optional cap on starting font search (px) */
  maxFontPx?: number;
  /** Rendered under the headline inside the text column (e.g. person name links). */
  belowTitle?: ReactNode;
};

/**
 * Top-aligned avatar + headline; headline font scales to fill avatar height (up to 3 wrapped lines).
 */
export function AvatarHeightHeadline({
  text,
  avatar,
  className = "",
  titleClassName = "",
  href,
  onTitleNavigate,
  linkTestId,
  serif = true,
  maxFontPx,
  belowTitle,
}: AvatarHeightHeadlineProps) {
  const avatarWrapRef = useRef<HTMLDivElement>(null);
  const textColRef = useRef<HTMLDivElement>(null);
  const [avatarHeight, setAvatarHeight] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const measure = useCallback(() => {
    const aw = avatarWrapRef.current;
    const tw = textColRef.current;
    if (aw) {
      const h = aw.getBoundingClientRect().height;
      if (h > 0) setAvatarHeight(Math.round(h));
    }
    if (tw) {
      const w = tw.getBoundingClientRect().width;
      if (w > 0) setTextWidth(Math.round(w));
    }
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, text, avatar]);

  useLayoutEffect(() => {
    const aw = avatarWrapRef.current;
    const tw = textColRef.current;
    if (!aw && !tw) return;
    const ro = new ResizeObserver(() => measure());
    if (aw) ro.observe(aw);
    if (tw) ro.observe(tw);
    return () => ro.disconnect();
  }, [measure]);

  const safeH = avatarHeight > 0 ? avatarHeight : 56;
  const safeW = textWidth > 0 ? textWidth : 280;

  const { ref: titleRef, fontSizePx } = useFitTextBlockToHeight({
    text,
    maxHeightPx: safeH,
    maxWidthPx: safeW,
    maxFontPx,
    lineHeight: 1.2,
    fontFamily: serif ? "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" : undefined,
  });

  const titleStyle: CSSProperties = {
    fontSize: fontSizePx,
    lineHeight: 1.2,
    ...(serif ? { fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" } : {}),
  };

  const titleEl = onTitleNavigate ? (
    <button
      type="button"
      data-testid={linkTestId}
      onClick={onTitleNavigate}
      className="block w-full min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
    >
      <h3
        ref={titleRef}
        style={titleStyle}
        className={`font-bold hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors ${titleClassName}`}
      >
        {text}
      </h3>
    </button>
  ) : href ? (
    <Link href={href} data-testid={linkTestId} className="block w-full min-w-0">
      <h3
        ref={titleRef}
        style={titleStyle}
        className={`font-bold hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors cursor-pointer ${titleClassName}`}
      >
        {text}
      </h3>
    </Link>
  ) : (
    <h3 ref={titleRef} style={titleStyle} className={`font-bold min-w-0 ${titleClassName}`}>
      {text}
    </h3>
  );

  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <div ref={avatarWrapRef} className="shrink-0">
        {avatar}
      </div>
      <div ref={textColRef} className="flex-1 min-w-0 self-stretch flex flex-col justify-start">
        {titleEl}
        {belowTitle}
      </div>
    </div>
  );
}
