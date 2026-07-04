import { useState, type CSSProperties, type MouseEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { CATEGORY_CHIP_RADIUS, POLL_CARD_PILL_SIZE_CLASSES } from "@/lib/filterControlStyles";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
} from "@/components/ui/popover";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
} from "@/components/ui/drawer";

interface InteractiveVotedPillProps {
  label: string;
  onChangeVote: () => void;
  onRemoveVote: () => void;
  removeVotePending?: boolean;
  pillClassName?: string;
  pillStyle?: CSSProperties;
  className?: string;
  "data-testid"?: string;
}

function MenuItems({
  onChangeVote,
  onRemoveVote,
  removeVotePending,
  CloseWrapper,
  changeVoteTestId,
  removeVoteTestId,
}: {
  onChangeVote: () => void;
  onRemoveVote: () => void;
  removeVotePending?: boolean;
  CloseWrapper: React.ComponentType<{ children: React.ReactNode; asChild?: boolean }>;
  changeVoteTestId?: string;
  removeVoteTestId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 py-1">
      <CloseWrapper asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors text-foreground"
          onClick={onChangeVote}
          data-testid={changeVoteTestId}
        >
          <Pencil className="h-4 w-4 opacity-60 shrink-0" />
          Change vote
        </button>
      </CloseWrapper>

      <CloseWrapper asChild>
        <button
          type="button"
          disabled={removeVotePending}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 text-sm text-left rounded-md hover:bg-muted/60 transition-colors text-red-600 dark:text-red-400 disabled:opacity-50 disabled:pointer-events-none"
          onClick={onRemoveVote}
          data-testid={removeVoteTestId}
        >
          <Trash2 className="h-4 w-4 opacity-60 shrink-0" />
          Remove vote
        </button>
      </CloseWrapper>
    </div>
  );
}

export function InteractiveVotedPill({
  label,
  onChangeVote,
  onRemoveVote,
  removeVotePending = false,
  pillClassName = "",
  pillStyle,
  className = "",
  "data-testid": testId,
}: InteractiveVotedPillProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleChangeVote = () => {
    setOpen(false);
    onChangeVote();
  };

  const handleRemoveVote = () => {
    setOpen(false);
    onRemoveVote();
  };

  const changeVoteTestId = testId ? `${testId}-change-vote` : undefined;
  const removeVoteTestId = testId ? `${testId}-remove-vote` : undefined;

  const stopPropagation = (e: MouseEvent) => {
    e.stopPropagation();
  };

  const pillButton = (
    <button
      type="button"
      aria-label={`${label}, vote options`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={stopPropagation}
      className={cn(
        "inline-flex items-center max-w-full shrink-0",
        CATEGORY_CHIP_RADIUS,
        POLL_CARD_PILL_SIZE_CLASSES,
        "border whitespace-nowrap transition-all duration-200 hover:opacity-80 cursor-pointer",
        pillClassName,
        className,
      )}
      style={pillStyle}
      data-testid={testId}
    >
      <span className="truncate">{label}</span>
    </button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild onClick={stopPropagation}>
          {pillButton}
        </DrawerTrigger>
        <DrawerContent>
          <div className="px-2 pb-4">
            <DrawerTitle className="sr-only">{label} vote actions</DrawerTitle>
            <MenuItems
              onChangeVote={handleChangeVote}
              onRemoveVote={handleRemoveVote}
              removeVotePending={removeVotePending}
              CloseWrapper={DrawerClose}
              changeVoteTestId={changeVoteTestId}
              removeVoteTestId={removeVoteTestId}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={stopPropagation}>
        {pillButton}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1" onClick={stopPropagation}>
        <MenuItems
          onChangeVote={handleChangeVote}
          onRemoveVote={handleRemoveVote}
          removeVotePending={removeVotePending}
          CloseWrapper={PopoverClose}
          changeVoteTestId={changeVoteTestId}
          removeVoteTestId={removeVoteTestId}
        />
      </PopoverContent>
    </Popover>
  );
}
