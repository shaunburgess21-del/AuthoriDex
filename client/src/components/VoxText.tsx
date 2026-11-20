import { Fragment } from "react";
import { VoxMark } from "@/components/VoxMark";
import { splitVoxText } from "@/lib/vox-text";
import { cn } from "@/lib/utils";

/**
 * Renders a formatted Vox string, swapping the raw glyph (and a won-sign
 * fallback) for {@link VoxMark}. Use this anywhere a number sits next to
 * the currency. Prose that already says "Vox" can stay as words.
 */
export function VoxText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  if (text == null || text === "") return null;
  const parts = splitVoxText(text);
  return (
    <span className={cn("inline", className)}>
      {parts.map((part, index) =>
        part.type === "mark" ? (
          <VoxMark key={`m-${index}`} />
        ) : (
          <Fragment key={`t-${index}`}>{part.value}</Fragment>
        ),
      )}
    </span>
  );
}
