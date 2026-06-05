import type { ReactNode } from "react";
import { Link } from "wouter";
import {
  Star,
  Vote,
  Swords,
  MessageSquare,
  BarChart3,
  UserPlus,
  ImageIcon,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { VOTE_HUB_DEEP_LINKS, type VoteHubSectionToggle } from "@/lib/voteHubDeepLinks";

export const INSIGHTS_APPROVAL_HREF = "/insights?tab=crowd";

export function InsightsApprovalLink({ children }: { children: React.ReactNode }) {
  return (
    <Link
      href={INSIGHTS_APPROVAL_HREF}
      className="font-medium text-primary hover:text-primary/80 underline underline-offset-2"
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </Link>
  );
}

function ApprovalSnapshot() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Star className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
        <h3 className="text-sm font-semibold">Approval rating</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        The <span className="font-medium text-foreground">Approval</span> score on each row is an aggregate from the VoxDex community (shown out of 5).
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Use <span className="font-medium text-foreground">Rate</span> on a row to cast your own 1–5 vote, which feeds into that person&apos;s approval rating.
      </p>
    </div>
  );
}

function DrawerNavList({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {children}
    </div>
  );
}

const VOTE_HUB_LINK_ICONS: Record<VoteHubSectionToggle, LucideIcon> = {
  "Sentiment Polls": MessageSquare,
  Matchups: Swords,
  "Opinion Polls": Vote,
  "Underrated/Overrated": BarChart3,
  "Induction Queue": UserPlus,
  "Curate Profile": ImageIcon,
};

function DrawerNavLink({
  href,
  label,
  icon: Icon,
  onNavigateLink,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  onNavigateLink: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={() => onNavigateLink()}
      className="flex min-h-10 items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40" aria-hidden>
          <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden />
        </span>
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

function ApprovalVoteHubSection({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <div className="mt-6 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">More on Vote</p>
      <DrawerNavList>
        {VOTE_HUB_DEEP_LINKS.map(({ label, href, sectionToggle }) => (
          <DrawerNavLink
            key={href}
            href={href}
            label={label}
            icon={VOTE_HUB_LINK_ICONS[sectionToggle]}
            onNavigateLink={onNavigateLink}
          />
        ))}
      </DrawerNavList>
    </div>
  );
}

export function ApprovalInfoBody({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <>
      <ApprovalSnapshot />
      <ApprovalVoteHubSection onNavigateLink={onNavigateLink} />
    </>
  );
}

/** Home leaderboard: Your Vote column only — no per-row Approval aggregate here. */
function HomeApprovalSnapshot() {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Star className="h-5 w-5 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden />
        <h3 className="text-sm font-semibold">Approval rating</h3>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Use <span className="font-medium text-foreground">Rate</span> on a row to cast your own 1–5 vote, which feeds into that person&apos;s approval rating.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Approval</span> ratings are aggregated from the VoxDex community and shown out of 5.
      </p>
    </div>
  );
}

/** Home leaderboard: rate CTA, aggregate context, Insights link, then Vote hub links. */
export function HomeApprovalInfoBody({ onNavigateLink }: { onNavigateLink: () => void }) {
  return (
    <>
      <HomeApprovalSnapshot />
      <p className="mt-4 border-t border-border/50 pt-3 text-xs leading-relaxed text-muted-foreground">
        To see community approval ratings, visit the <InsightsApprovalLink>Insights</InsightsApprovalLink> page.
      </p>
      <ApprovalVoteHubSection onNavigateLink={onNavigateLink} />
    </>
  );
}

export function YourVoteColumnHeaderButton({
  onClick,
  className,
  testId = "button-approval-your-vote-info",
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
      aria-label="About approval rating and Rate on the leaderboard"
      data-testid={testId}
      onClick={onClick}
    >
      Your Vote
    </Button>
  );
}

export const yourVoteInfoDialogTitle = "Your vote on the leaderboard";
export const yourVoteInfoDialogDescription = "How approval ratings work.";

const yourVoteDialogContentClass =
  "flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-sm";

function YourVoteInfoDialogHeader({
  Title,
  Description,
}: {
  Title: typeof DialogTitle | typeof DrawerTitle;
  Description: typeof DialogDescription | typeof DrawerDescription;
}) {
  return (
    <>
      <Title className="text-base leading-snug">{yourVoteInfoDialogTitle}</Title>
      <Description>{yourVoteInfoDialogDescription}</Description>
    </>
  );
}

export function YourVoteInfoDialog({
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
      <DialogContent className={cn(yourVoteDialogContentClass)}>
        <DialogHeader className="shrink-0 space-y-1 pr-6 text-left">
          <YourVoteInfoDialogHeader Title={DialogTitle} Description={DialogDescription} />
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-1">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function YourVoteInfoDrawer({
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
          <YourVoteInfoDialogHeader Title={DrawerTitle} Description={DrawerDescription} />
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6 pt-0">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
