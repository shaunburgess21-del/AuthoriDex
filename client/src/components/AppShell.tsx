import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
  /** Content rendered inside the sticky top header bar. */
  header?: ReactNode;
  /** Extra classes on the outer wrapper (e.g. a page-level max-width). */
  className?: string;
  /** Disable the default bottom padding that clears the mobile BottomNav. */
  noPadBottom?: boolean;
}

/**
 * Shared page shell that provides:
 * - a sticky, blurred top header
 * - consistent horizontal padding
 * - bottom padding to clear the mobile BottomNav
 */
export function AppShell({
  children,
  header,
  className,
  noPadBottom,
}: AppShellProps) {
  return (
    <div className={cn("min-h-screen", !noPadBottom && "pb-20 md:pb-0", className)}>
      {header && (
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
          <div className="container mx-auto px-4">{header}</div>
        </header>
      )}
      <main className="container mx-auto px-4">{children}</main>
    </div>
  );
}
