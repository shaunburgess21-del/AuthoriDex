import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Star,
  Vote,
  TrendingUp,
  UserPlus,
  Info,
  Newspaper,
  BookOpen,
  Search,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Activity,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { INSIGHTS_APPROVAL_HREF } from "@/components/ApprovalLeaderboardInfo";

// The Trend Score control used to be a text-heavy info tooltip that dead-ended.
// It is now a "now what" launchpad: a short menu of onward actions, with the
// explainer demoted to a quiet, opt-in paginated sequence that itself exits
// into the approval-ratings CTA.
//
// Judgment call: the sibling "Your Vote" control on this same header row opens
// a Dialog (desktop) / Drawer (mobile) split, so we mirror that here for visual
// consistency between the two adjacent header controls (rather than the desktop
// Popover originally sketched).

type LaunchpadView = "menu" | "explainer";

interface TrendScoreLaunchpadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isMobile: boolean;
}

interface MenuAction {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const MENU_ACTIONS: MenuAction[] = [
  {
    href: INSIGHTS_APPROVAL_HREF,
    label: "See approval ratings",
    description: "How the community actually feels",
    icon: Star,
  },
  {
    href: "/vote",
    label: "Vote on global topics",
    description: "Have your say on what's trending",
    icon: Vote,
  },
  {
    href: "/predict",
    label: "Make a prediction",
    description: "Back your call on real-world markets",
    icon: TrendingUp,
  },
  {
    // Figure-induction flow ("Induction Queue") — suggest a NEW figure for the
    // main leaderboard. Distinct from the topic/matchup/poll suggest buttons.
    href: "/vote/induction",
    label: "Suggest someone for the leaderboard",
    description: "Who are we missing?",
    icon: UserPlus,
  },
];

function MenuRow({
  action,
  onNavigate,
}: {
  action: MenuAction;
  onNavigate: () => void;
}) {
  const { href, label, description, icon: Icon } = action;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex min-h-12 items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40"
          aria-hidden
        >
          <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{label}</span>
          <span className="truncate text-xs text-muted-foreground">{description}</span>
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}

function MenuView({
  onNavigate,
  onShowExplainer,
}: {
  onNavigate: () => void;
  onShowExplainer: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="mb-3">
        <h3 className="text-base font-semibold leading-snug">Trending now — what&apos;s next?</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          You&apos;ve seen who&apos;s getting attention. Here&apos;s where to take it.
        </p>
      </div>

      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card/40">
        {MENU_ACTIONS.map((action) => (
          <MenuRow key={action.href} action={action} onNavigate={onNavigate} />
        ))}
      </div>

      <button
        type="button"
        onClick={onShowExplainer}
        className="mt-3 flex items-center gap-2 self-start rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="button-trend-score-how-it-works"
      >
        <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
        How Trend Score works
      </button>
    </div>
  );
}

interface ExplainerScreen {
  title: string;
  render: () => JSX.Element;
}

function SourceRow({
  icon: Icon,
  iconClassName,
  title,
  description,
}: {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/40"
        aria-hidden
      >
        <Icon className={cn("h-4 w-4", iconClassName)} />
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
    </li>
  );
}

const EXPLAINER_SCREENS: ExplainerScreen[] = [
  {
    title: "What Trend Score measures",
    render: () => (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          How much attention someone is getting right now, pulled from public data:
        </p>
        <ul className="space-y-3">
          <SourceRow
            icon={Newspaper}
            iconClassName="text-red-500"
            title="News coverage"
            description="How often they appear in recent articles"
          />
          <SourceRow
            icon={BookOpen}
            iconClassName="text-gray-400"
            title="Wikipedia activity"
            description="How often people read about them"
          />
          <SourceRow
            icon={Search}
            iconClassName="text-muted-foreground"
            title="Search & mentions"
            description="How they're trending across the web"
          />
        </ul>
        <p className="text-[10px] leading-relaxed text-muted-foreground/60">
          Sources: Mediastack · Wikimedia · SerpApi · CurrentsAPI · APILayer · DataForSEO · OpenAI · Serper · GDELT
        </p>
      </div>
    ),
  },
  {
    title: "One live score",
    render: () => (
      <div className="space-y-4">
        <div className="flex items-center justify-center gap-3 py-2" aria-hidden>
          <div className="flex gap-1.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <Newspaper className="h-4 w-4 text-red-500" />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <BookOpen className="h-4 w-4 text-gray-400" />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted/40">
              <Search className="h-4 w-4 text-muted-foreground" />
            </span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <span className="flex h-10 items-center gap-1.5 rounded-lg bg-cyan-500/10 px-3 text-cyan-600 dark:text-cyan-400">
            <Activity className="h-4 w-4" />
            <span className="text-sm font-semibold">Score</span>
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          We blend these signals into a single number that updates as new data
          comes in. A higher score means more attention recently — rising and
          falling as the story moves.
        </p>
      </div>
    ),
  },
  {
    title: "Attention, not approval",
    render: () => (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Trend Score counts all attention — positive and negative alike. It
          doesn&apos;t say whether people approve. For how the community actually
          feels, check approval ratings.
        </p>
      </div>
    ),
  },
];

function ExplainerView({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: () => void;
}) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const isLastStep = step === EXPLAINER_SCREENS.length - 1;
  const screen = EXPLAINER_SCREENS[step];

  const goBack = () => {
    if (step === 0) {
      onBack();
      return;
    }
    setDirection(-1);
    setStep((s) => s - 1);
  };

  const goNext = () => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, EXPLAINER_SCREENS.length - 1));
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={step === 0 ? "Back to actions" : "Previous"}
          data-testid="button-trend-score-explainer-back"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-1 items-center justify-center gap-1.5">
          {EXPLAINER_SCREENS.map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
        {/* Spacer to keep dots centered against the back button */}
        <div className="h-7 w-7 shrink-0" aria-hidden />
      </div>

      <div className="relative min-h-[180px] overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.2 }}
          >
            <h3 className="mb-3 text-base font-semibold leading-snug">{screen.title}</h3>
            {screen.render()}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5">
        {isLastStep ? (
          <div className="flex flex-col gap-2">
            <Link
              href={INSIGHTS_APPROVAL_HREF}
              onClick={onNavigate}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90"
              data-testid="link-trend-score-explainer-insights"
            >
              See approval ratings
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={onNavigate}
              className="inline-flex w-full items-center justify-center rounded-xl px-6 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="button-trend-score-explainer-done"
            >
              Done
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-muted px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/80"
            data-testid="button-trend-score-explainer-next"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function LaunchpadBody({
  view,
  setView,
  onClose,
}: {
  view: LaunchpadView;
  setView: (view: LaunchpadView) => void;
  onClose: () => void;
}) {
  if (view === "explainer") {
    return <ExplainerView onBack={() => setView("menu")} onNavigate={onClose} />;
  }
  return (
    <MenuView onNavigate={onClose} onShowExplainer={() => setView("explainer")} />
  );
}

export function TrendScoreLaunchpad({
  open,
  onOpenChange,
  isMobile,
}: TrendScoreLaunchpadProps) {
  const [view, setView] = useState<LaunchpadView>("menu");

  // Always reopen on the menu, never mid-explainer.
  useEffect(() => {
    if (!open) {
      const id = window.setTimeout(() => setView("menu"), 200);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const close = () => onOpenChange(false);
  const a11yTitle = view === "explainer" ? "How Trend Score works" : "What's next";

  const body = <LaunchpadBody view={view} setView={setView} onClose={close} />;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerTitle className="sr-only">{a11yTitle}</DrawerTitle>
          <DrawerDescription className="sr-only">
            Actions and explainer for the Trend Score leaderboard.
          </DrawerDescription>
          <div className="overflow-y-auto px-4 pb-6 pt-4">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-sm">
        <DialogTitle className="sr-only">{a11yTitle}</DialogTitle>
        <DialogDescription className="sr-only">
          Actions and explainer for the Trend Score leaderboard.
        </DialogDescription>
        <div className="min-h-0 overflow-y-auto px-1 pt-1">{body}</div>
      </DialogContent>
    </Dialog>
  );
}
