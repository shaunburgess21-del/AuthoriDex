/**
 * One quiet line under result bars. The box is always one line tall
 * so the post-vote layout does not jump when the copy resolves.
 */
import { cn } from "@/lib/utils";
export function CrowdLine({
  text,
  testId = "crowd-line",
  className,
}: {
  text: string | null;
  testId?: string;
  className?: string;
}) {
  return (
    <p
      className={cn("mt-2 h-5 truncate text-[11px] leading-5 text-muted-foreground", className)}
      data-testid={testId}
      aria-hidden={text == null}
    >
      {text ?? "\u00a0"}
    </p>
  );
}
