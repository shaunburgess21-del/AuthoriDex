import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function PredictCard({
  children,
  className = "",
  testId,
  onClick,
  selected = false,
  inactive = false,
  inactiveMessage,
  autoSize = false,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  onClick?: () => void;
  selected?: boolean;
  inactive?: boolean;
  inactiveMessage?: string;
  autoSize?: boolean;
}) {
  const heightClass = autoSize ? "max-md:h-auto md:h-full" : "h-full";
  const cardContent = (
    <div
      className={`relative group overflow-visible ${heightClass} ${onClick && !inactive ? "cursor-pointer" : ""} ${inactive ? "cursor-default" : ""}`}
      onClick={inactive ? undefined : onClick}
      data-testid={testId}
    >
      <Card
        className={`relative px-3 sm:px-4 py-4 bg-card/95 backdrop-blur-sm transition-all flex flex-col rounded-[12px] md:rounded-xl ${heightClass} ${autoSize ? "" : "min-h-[390px]"} md:min-h-0 border-0 md:border md:border-transparent shadow-none md:shadow-sm ${
          inactive
            ? "opacity-50 grayscale-[40%]"
            : `md:ring-inset md:ring-1 md:ring-transparent md:transition-[box-shadow,ring-color] md:group-hover:ring-[#EFEFEF]/50 md:group-hover:shadow-lg md:group-hover:shadow-[0_8px_32px_rgba(239,239,239,0.1)] ${selected ? "md:ring-[#EFEFEF]/50 shadow-lg shadow-[0_8px_32px_rgba(239,239,239,0.14)]" : ""}`
        } ${className}`}
      >
        {inactive && (
          <div className="absolute top-3 right-3 z-10">
            <Badge
              variant="outline"
              className="text-xs border-amber-500/50 dark:border-amber-500/40 text-amber-700 dark:text-amber-500 bg-amber-500/15 dark:bg-amber-500/10"
            >
              <Clock className="h-3 w-3 mr-1" />
              {inactiveMessage || "Coming Soon"}
            </Badge>
          </div>
        )}
        <div className={autoSize ? "flex flex-col max-md:flex-none md:flex-1" : "flex flex-col flex-1"}>{children}</div>
      </Card>
    </div>
  );

  if (inactive) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-xs">{inactiveMessage || "This market is coming soon. Stay tuned!"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return cardContent;
}
