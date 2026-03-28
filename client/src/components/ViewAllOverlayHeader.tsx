import { Button } from "@/components/ui/button";
import { ChevronLeft, X } from "lucide-react";
import type { ReactNode } from "react";

export function ViewAllOverlayHeader({
  onClose,
  children,
  closeTestId = "button-close-overlay",
  backTestId = "button-back-overlay",
  className,
}: {
  onClose: () => void;
  children: ReactNode;
  closeTestId?: string;
  backTestId?: string;
  className?: string;
}) {
  return (
    <div className={className ?? "flex items-center justify-between gap-2"}>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Back"
          data-testid={backTestId}
          className="shrink-0"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
        data-testid={closeTestId}
        className="shrink-0"
      >
        <X className="h-5 w-5" />
      </Button>
    </div>
  );
}
