import * as React from "react"
import { X } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, tooltipSurfaceClass } from "./tooltip"
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

  // Tooltip path: width/typography overrides only — surface skin comes
  // from TooltipContent itself.
  const tooltipMergedClass = cn(
    "w-auto max-w-[260px] px-3 py-2 text-sm",
    contentClassName,
    className
  );

  // Popover path (touch fallback): apply the same premium tooltip surface
  // to PopoverContent so mobile users see an identical visual instead of
  // the default flat popover skin. We override `bg-popover` (Popover sets
  // its own) by appending tooltipSurfaceClass *after* the base classes.
  const popoverMergedClass = cn(
    tooltipSurfaceClass,
    // Reset the bits TooltipContent doesn't know about / that conflict
    // with PopoverContent's defaults
    "w-auto max-w-[260px]",
    contentClassName,
    className,
    showCloseButton && "relative pr-8",
  );

  if (isTouchDevice) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <span
            className="relative inline-flex items-center justify-center cursor-help text-inherit before:absolute before:inset-[-12px] before:content-['']"
            role="button"
            tabIndex={0}
            aria-label="More info"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setOpen((prev) => !prev);
              }
            }}
          >
            {children}
          </span>
        </PopoverTrigger>
        <PopoverContent side={side} align={align} className={popoverMergedClass}>
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
      <TooltipContent side={side} align={align} className={tooltipMergedClass}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
