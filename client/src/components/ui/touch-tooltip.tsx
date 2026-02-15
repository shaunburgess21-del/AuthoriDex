import * as React from "react"
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
}

export function TouchTooltip({ children, content, side = "top", align = "center", className, contentClassName }: TouchTooltipProps) {
  const [isTouchDevice, setIsTouchDevice] = React.useState(false);

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
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center bg-transparent border-0 p-0 m-0 cursor-help text-inherit font-inherit text-left">
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent side={side} align={align} className={mergedClass}>
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
