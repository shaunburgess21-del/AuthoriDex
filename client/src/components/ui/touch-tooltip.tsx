import * as React from "react"
import { X } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "./tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"
import { cn } from "@/lib/utils"

interface TouchTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  className?: string;
  contentClassName?: string;
  showCloseButton?: boolean;
}

export function TouchTooltip({ children, content, side = "top", align = "center", className, contentClassName, showCloseButton = false }: TouchTooltipProps) {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  const mergedClass = cn(
    "w-auto max-w-[260px] px-3 py-2 text-sm",
    contentClassName,
    className
  );

  if (isTouchDevice) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center bg-transparent border-0 p-0 m-0 cursor-help text-inherit font-inherit text-left min-w-[44px] min-h-[44px] -m-3"
            aria-label="More info"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent side={side} align={align} className={cn(mergedClass, showCloseButton && "relative pr-8")}>
          {showCloseButton && (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center cursor-help text-inherit">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className={mergedClass}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
