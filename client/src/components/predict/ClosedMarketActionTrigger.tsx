import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ClosedMarketMessage } from "@/lib/marketClosedMessaging";

type PopoverSide = "top" | "right" | "bottom" | "left";
type PopoverAlign = "start" | "center" | "end";

interface ClosedMarketActionTriggerProps {
  isClosed: boolean;
  message: Pick<ClosedMarketMessage, "title" | "lines">;
  children: ReactElement;
  side?: PopoverSide;
  align?: PopoverAlign;
  contentClassName?: string;
}

export function ClosedMarketActionTrigger({
  isClosed,
  message,
  children,
  side = "top",
  align = "center",
  contentClassName = "",
}: ClosedMarketActionTriggerProps) {
  if (!isClosed || !isValidElement(children)) {
    return children;
  }

  const wrappedChild = cloneElement(children as ReactElement<any>, {
    "aria-disabled": true,
    onClick: (event: any) => {
      event.stopPropagation();
    },
    onClickCapture: (event: any) => {
      event.stopPropagation();
    },
    onPointerDownCapture: (event: any) => {
      event.stopPropagation();
    },
    onKeyDown: (event: any) => {
      event.stopPropagation();
    },
    onKeyDownCapture: (event: any) => {
      event.stopPropagation();
    },
  });

  return (
    <Popover modal>
      <PopoverTrigger asChild>{wrappedChild as ReactNode}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={10}
        collisionPadding={12}
        onClick={(event) => event.stopPropagation()}
        className={`w-[min(22rem,94vw)] p-3 ${contentClassName}`.trim()}
      >
        <div className="space-y-2">
          <p className="text-sm font-semibold">{message.title}</p>
          {message.lines.map((line, idx) => (
            <p key={`closed-market-line-${idx}`} className="text-[11px] sm:text-xs text-muted-foreground leading-relaxed">
              {line}
            </p>
          ))}
          <PopoverClose asChild>
            <Button variant="outline" size="sm" className="w-full text-xs">
              Close
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}
