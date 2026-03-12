import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { HelpCircle, ChevronRight, type LucideIcon } from "lucide-react";

interface HelpContent {
  title: string;
  bullets: string[];
}

interface HomeSectionHeaderProps {
  theme: "vote" | "predict";
  icon: LucideIcon;
  title: string;
  subtitle: string;
  help?: HelpContent;
  onViewAll?: () => void;
}

export function HomeSectionHeader({
  theme,
  icon: Icon,
  title,
  subtitle,
  help,
  onViewAll,
}: HomeSectionHeaderProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  const isVote = theme === "vote";
  const accentText = isVote ? "text-cyan-400" : "text-violet-400";
  const accentBg = isVote ? "from-cyan-500/8 to-cyan-500/3" : "from-violet-500/8 to-violet-500/3";
  const accentBorder = isVote ? "border-cyan-500/15" : "border-violet-500/15";
  const accentIconBg = isVote ? "bg-cyan-500/10" : "bg-violet-500/10";
  const helpBulletDot = isVote ? "bg-cyan-400" : "bg-violet-400";

  const testId = title.toLowerCase().replace(/[\s/]+/g, '-');

  return (
    <>
      <div
        className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-gradient-to-r ${accentBg} border ${accentBorder}`}
        data-testid={`text-section-${testId}`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${accentIconBg}`}>
            <Icon className={`h-3.5 w-3.5 ${accentText}`} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold leading-tight truncate">{title}</h3>
            <p className="text-[11px] text-muted-foreground leading-tight truncate">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {help && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHelpOpen(true)}
              aria-label="Help"
              data-testid={`button-help-${testId}`}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </Button>
          )}
          {onViewAll && (
            <Button
              variant="ghost"
              size="sm"
              className={`${accentText}`}
              onClick={onViewAll}
              data-testid={`link-viewall-${testId}`}
            >
              View all
              <ChevronRight className="h-3 w-3 ml-0.5" />
            </Button>
          )}
        </div>
      </div>

      {help && (
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Icon className={`h-5 w-5 ${accentText}`} />
                {help.title}
              </DialogTitle>
              <DialogDescription className="sr-only">Learn how this section works</DialogDescription>
            </DialogHeader>
            <ul className="space-y-3 py-2">
              {help.bullets.map((bullet, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className={`h-1.5 w-1.5 rounded-full ${helpBulletDot} mt-1.5 shrink-0`} />
                  {bullet}
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
