import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export const WEB_SENTIMENT_PROFILE_TOOLTIP_COPY =
  "We scan recent English-language news sites, blogs, and forums for mentions of this person. Automated analysis sorts each mention as positive or negative — the headline % is the share that's positive, and the bar shows the split. Mentions is the total count of opinionated mentions found.\n\nThis is not crowd Approval (the 1–5 rating from VoxDex users in the Vote tab) — it reflects what the wider web is saying, not the VoxDex crowd. Updates about weekly.";

export function SentimentInfoBody() {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-muted-foreground">
        We scan recent English-language news sites, blogs, and forums for mentions of each person.
        Automated analysis sorts each mention as positive or negative — the headline % is the share
        that's positive, and the bar shows the split. Mentions is the total count of opinionated
        mentions found.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        This is not crowd Approval (the 1–5 rating from VoxDex users in the Vote tab) — it reflects
        what the wider web is saying, not the VoxDex crowd. Updates about weekly.
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Profiles with too few opinionated mentions are hidden because the percentage wouldn't be
        meaningful. Sentiment detection is automated, so individual mentions are occasionally
        misread and may not always be 100% accurate.
      </p>
    </div>
  );
}

export function SentimentColumnHeaderButton({
  onClick,
  className,
  testId = "button-web-sentiment-info",
}: {
  onClick: () => void;
  className?: string;
  testId?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "h-9 min-h-9 w-auto shrink-0 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
      aria-label="About Web Sentiment on the leaderboard"
      data-testid={testId}
      onClick={onClick}
    >
      Sentiment
    </Button>
  );
}

export const sentimentInfoDialogTitle = "Web Sentiment on the leaderboard";
export const sentimentInfoDialogDescription = "How positive vs negative web coverage is measured.";

const sentimentDialogContentClass =
  "flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-sm";

function SentimentInfoDialogHeader({
  Title,
  Description,
}: {
  Title: typeof DialogTitle | typeof DrawerTitle;
  Description: typeof DialogDescription | typeof DrawerDescription;
}) {
  return (
    <>
      <Title className="text-base leading-snug">{sentimentInfoDialogTitle}</Title>
      <Description>{sentimentInfoDialogDescription}</Description>
    </>
  );
}

export function SentimentInfoDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(sentimentDialogContentClass)}>
        <DialogHeader className="shrink-0 space-y-1 pr-6 text-left">
          <SentimentInfoDialogHeader Title={DialogTitle} Description={DialogDescription} />
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function SentimentInfoDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="space-y-1 px-4 pb-2 pt-4 text-left">
          <SentimentInfoDialogHeader Title={DrawerTitle} Description={DrawerDescription} />
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6 pt-0">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
