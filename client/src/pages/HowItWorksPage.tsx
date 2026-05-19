import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, BookOpen, ChevronRight, Flame, Info, Sparkles } from "lucide-react";
import {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
} from "@shared/streak-config";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useUserStats } from "@/hooks/useGamification";
import { useAuth } from "@/contexts/AuthContext";
import {
  KNOWLEDGE_TABS,
  XP_ACTIONS,
  RANKS,
  CAPABILITY_GATES,
  VOTE_SURFACES,
  PREDICT_SURFACES,
  type KnowledgeTab,
  type KnowledgeTabId,
  type XpActionRow,
} from "@/lib/gamification-content";
import {
  CREDIT_ACTIONS,
  CREDIT_CATEGORIES,
  SIGNUP_CREDIT_GRANT,
  type CreditActionConfig,
  type CreditCategory,
} from "@shared/credit-config";
import { BADGES, type BadgeCategory } from "@shared/badge-config";
import { cn } from "@/lib/utils";

/**
 * Local tab bar mirroring ProfileTabs visually (muted track, raised active
 * segment, 2px accent underline, icon tinted on active) but scrolling
 * horizontally on small screens. Six tabs with icons + labels overflow the
 * standard ProfileTabs flex-1 layout below ~420px viewport width — this
 * variant keeps everything reachable on mobile without clipping.
 */
function KnowledgeTabsBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: KnowledgeTab[];
  activeTab: KnowledgeTabId;
  onTabChange: (tab: KnowledgeTabId) => void;
}) {
  return (
    <div data-testid="knowledge-tabs">
      <div className="flex items-center gap-0 rounded-lg bg-muted/50 p-0.5 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`
                relative flex items-center justify-center gap-1.5 flex-1 sm:flex-1
                whitespace-nowrap px-2.5 sm:px-4 py-[11px] rounded-md text-[13px] sm:text-[14px] font-medium transition-all
                min-w-fit
                ${isActive
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
                }
              `}
              data-testid={`tab-${tab.id}`}
            >
              {isActive && (
                <span
                  className={
                    tab.id === "xp"
                      ? "absolute bottom-0 left-1 right-1 h-[2px] rounded-full bg-slate-600 dark:bg-white"
                      : "absolute bottom-0 left-1 right-1 h-[2px] rounded-full"
                  }
                  style={
                    tab.id === "xp" ? undefined : { backgroundColor: tab.accent }
                  }
                />
              )}
              <Icon
                className={
                  isActive && tab.id === "xp"
                    ? "h-[16px] w-[16px] sm:h-[18px] sm:w-[18px] text-slate-600 dark:text-white"
                    : "h-[16px] w-[16px] sm:h-[18px] sm:w-[18px]"
                }
                style={
                  isActive && tab.id !== "xp" ? { color: tab.accent } : undefined
                }
              />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function accentFor(id: KnowledgeTabId): string {
  return KNOWLEDGE_TABS.find((tab) => tab.id === id)!.accent;
}

function SectionHeading({
  id,
  title,
  subtitle,
}: {
  id: KnowledgeTabId;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="space-y-1">
      <h2
        className={
          id === "xp"
            ? "text-2xl font-semibold tracking-tight text-slate-700 dark:text-white"
            : "text-2xl font-semibold tracking-tight"
        }
        style={id === "xp" ? undefined : { color: accentFor(id) }}
      >
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function StatPill(
  props:
    | { label: string; value: string; sublabel?: string; variant: "xp-chrome" }
    | { label: string; value: string; sublabel?: string; accent: string; variant?: "default" },
) {
  if (props.variant === "xp-chrome") {
    const { label, value, sublabel } = props;
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 dark:border-white/35 dark:bg-white/[0.06]">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="flex flex-col items-end leading-tight">
          <span className="font-mono text-sm font-semibold text-slate-800 dark:text-white">
            {value}
          </span>
          {sublabel && (
            <span className="text-[10px] text-muted-foreground">{sublabel}</span>
          )}
        </span>
      </div>
    );
  }
  const { label, value, sublabel, accent } = props;
  return (
    <div
      className="flex items-center justify-between rounded-lg border px-3 py-2"
      style={{
        borderColor: `${accent}66`,
        backgroundColor: `${accent}14`,
      }}
    >
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex flex-col items-end leading-tight">
        <span className="font-mono text-sm font-semibold" style={{ color: accent }}>
          {value}
        </span>
        {sublabel && (
          <span className="text-[10px] text-muted-foreground">{sublabel}</span>
        )}
      </span>
    </div>
  );
}

function formatCap(cap: number | null): string {
  return cap === null ? "No cap" : `${cap} / day`;
}

function XpActionTable({ rows }: { rows: XpActionRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium text-right">XP</th>
            <th className="px-3 py-2 font-medium text-right">Daily Cap</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.actionKey}
              className="border-t border-border/60 align-top"
            >
              <td className="px-3 py-2">
                <div className="font-medium">{row.displayName}</div>
              </td>
              <td className="px-3 py-2 text-right">
                <span className="font-mono font-semibold text-slate-700 dark:text-white">
                  {row.xpValue > 0 ? `+${row.xpValue}` : row.xpValue}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">
                {formatCap(row.dailyCap)}
              </td>
              <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                {row.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Categories shown to end users. The `Special` category exists in
 * XP_ACTIONS for the admin portal / XP audit views but is intentionally
 * hidden here — Legacy Migration and Admin Adjustment are not user-
 * earnable actions and surfacing them on /how-it-works just confused
 * the prose ("daily max includes admin-only zero-XP entries").
 */
const USER_FACING_XP_CATEGORIES: XpActionRow["category"][] = [
  "Voting",
  "Content",
  "Engagement",
  "Prediction",
  "Streak",
];

interface XpSectionProps {
  onJumpToTab?: (tab: KnowledgeTabId) => void;
}

function XpSection({ onJumpToTab }: XpSectionProps) {
  const grouped = useMemo(() => {
    return USER_FACING_XP_CATEGORIES.map((category) => ({
      category,
      rows: XP_ACTIONS.filter((row) => row.category === category),
    }));
  }, []);

  // "Ways to earn" reflects what the user can actually see on this
  // page — admin-only actions are hidden, so they don't count.
  const userFacingActions = useMemo(
    () =>
      XP_ACTIONS.filter((row) =>
        USER_FACING_XP_CATEGORIES.includes(row.category),
      ),
    [],
  );

  // Theoretical daily maximum: sum of (xpValue × dailyCap) for every
  // capped, user-earnable action, plus a single occurrence of each
  // uncapped bonus (suggestion_approved, prediction_win) representing
  // the realistic "one big payoff" case. Streak milestones are
  // lifetime-once and therefore excluded — including them in the
  // daily figure would inflate the headline number for an event that
  // can't recur.
  const maxDaily = useMemo(() => {
    return userFacingActions.reduce((sum, row) => {
      if (row.xpValue === 0) return sum;
      // Skip lifetime-once streak milestones (action keys begin with
      // streak_milestone_) so they don't dominate the daily total.
      if (row.actionKey.startsWith("streak_milestone_")) return sum;
      if (row.dailyCap === null) {
        // Uncapped one-shot bonuses: count one expected occurrence.
        return sum + row.xpValue;
      }
      return sum + row.xpValue * row.dailyCap;
    }, 0);
  }, [userFacingActions]);

  return (
    <section className="space-y-6">
      <SectionHeading
        id="xp"
        title="XP — Experience Points"
        subtitle="The headline progression metric. Earned from almost every meaningful interaction. Drives your rank."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatPill
          label="Ways to earn"
          value={String(userFacingActions.length)}
          variant="xp-chrome"
        />
        <StatPill
          label="Daily maximum"
          value={`${maxDaily.toLocaleString()} XP`}
          variant="xp-chrome"
        />
        <StatPill
          label="Milestone bonus"
          value="+500 XP"
          sublabel="Day 100 streak"
          variant="xp-chrome"
        />
      </div>

      <RankLadderStrip onJumpToRanks={() => onJumpToTab?.("ranks")} />

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">How XP is awarded</h3>
        <p className="text-sm text-muted-foreground">
          Every action you take on VoxDex that contributes to the community
          earns you XP. Votes, predictions, comments, streaks — it all counts.
        </p>
        <p className="text-sm text-muted-foreground">
          Each action can only award XP once per event — you'll never get
          double credit for the same thing, even if something goes wrong on
          our end.
        </p>
        <p className="text-sm text-muted-foreground">
          Most actions have a daily limit to keep things fair. Hitting a limit
          just means you stop earning XP for that action today — everything
          else still counts, and limits reset at midnight UTC.
        </p>
        <p className="text-sm text-muted-foreground">
          When you earn enough XP to cross a rank threshold, your rank updates
          automatically and you'll get a notification.
        </p>
      </Card>

      {grouped.map(({ category, rows }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <XpActionTable rows={rows} />
          {category === "Streak" && <StreakExplainer />}
        </div>
      ))}

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          XP shows up in the avatar menu (live progress bar to next rank), on
          your account page, and on your public profile. Streak milestones
          generate dedicated notifications so you never miss a tier-up.
        </p>
      </Card>
    </section>
  );
}

/**
 * Compact horizontal rank ladder — eight tiered chips on a scrollable
 * strip, anchored above the "How XP is awarded" prose. Highlights the
 * authenticated user's current tier so the section reads as "here's
 * where you are, here's what's ahead". Falls back to no-highlight for
 * logged-out users (we still show the full ladder so the rank
 * progression is discoverable to first-time visitors).
 *
 * Tier data comes straight from RANKS (the same source the dedicated
 * Ranks tab uses), so threshold tweaks land in one place.
 */
function RankLadderStrip({ onJumpToRanks }: { onJumpToRanks: () => void }) {
  const { isLoggedIn } = useAuth();
  const { data: stats } = useUserStats(isLoggedIn);
  const currentTier = stats?.rank?.tier ?? null;

  return (
    <div className="space-y-2">
      {/* Mobile: horizontal scroll keeps the strip approachable on
          narrow viewports. Desktop: 4-column grid (two rows of four)
          so each chip has roughly twice the width of the old 8-col
          layout — full names like "Hall of Famer" and "VoxMaximus"
          fit on one line, with a 2-line fallback for any future
          longer names via `line-clamp-2`. The chip itself flips to
          a vertical stack on desktop (tier circle on top, name +
          XP centred below) so the title can use the chip's full
          horizontal real estate. */}
      <div
        className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide md:grid md:grid-cols-4 md:gap-3 md:overflow-visible"
        data-testid="rank-ladder-strip"
      >
        {RANKS.map((rank) => {
          const isCurrent = currentTier === rank.tier;
          return (
            <div
              key={rank.tier}
              data-testid={`rank-ladder-tier-${rank.tier}`}
              className={`shrink-0 md:shrink min-w-[110px] md:min-w-0 rounded-lg border px-2 py-2 md:px-3 md:py-2.5 transition-colors ${
                isCurrent
                  ? "border-amber-500/60 bg-amber-500/10 shadow-[0_0_0_2px_rgba(245,158,11,0.2)]"
                  : "border-border/60 bg-muted/30"
              }`}
            >
              <div className="flex items-center gap-2 md:flex-col md:items-center md:gap-1.5 md:text-center">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: rank.color }}
                >
                  {rank.tier}
                </span>
                <div className="min-w-0 leading-tight md:w-full">
                  <p className="truncate md:whitespace-normal md:line-clamp-2 md:text-balance text-[12px] font-semibold">
                    {rank.name}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {rank.minXp.toLocaleString()} XP
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onJumpToRanks}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        data-testid="link-jump-to-ranks"
      >
        See what each rank unlocks
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Plain-language explainer for the streak system. Reads the milestone
 * ladder from shared/streak-config.ts so amounts shown here are
 * guaranteed to match what the daily-checkin handler actually awards.
 */
function StreakExplainer() {
  return (
    <Card className="space-y-4 p-4 border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-transparent">
      <div className="flex items-start gap-3">
        <Flame className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
        <div className="space-y-1">
          <h4 className="font-semibold text-base">How streaks work</h4>
          <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
            <li>Log in every day to build your streak.</li>
            <li>
              Your streak is the number of consecutive days you've been active
              on VoxDex.
            </li>
            <li>
              Miss a day? You get one grace day — your streak survives a
              single missed day.
            </li>
            <li>Miss two days in a row and your streak resets to 1.</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/60 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h4 className="font-semibold text-base">Milestone rewards</h4>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {STREAK_MILESTONES.map((day) => (
            <div
              key={day}
              className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2"
              data-testid={`streak-milestone-${day}`}
            >
              <span className="text-sm font-medium">Day {day}</span>
              <span className="font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                +{STREAK_MILESTONE_XP[day]} XP
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Each milestone bonus is awarded once per account — they sit on top
          of your daily login XP and the standard streak bonus.
        </p>
      </div>

      <div className="border-t border-border/60 pt-3">
        <p className="text-xs text-muted-foreground">
          Prediction wins also earn bonus XP — and a dedicated win streak
          system is coming to the Predict section.
        </p>
      </div>
    </Card>
  );
}

function RanksSection() {
  const accent = accentFor("ranks");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="ranks"
        title="Ranks — Your VoxDex Reputation"
        subtitle="Eight tiers that signal your standing, unlock platform capabilities, and mark your journey from newcomer to legend."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {RANKS.map((rank) => (
          <Card key={rank.tier} className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: rank.color }}
                >
                  {rank.tier}
                </span>
                <div>
                  <div className="font-semibold">{rank.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {rank.minXp.toLocaleString()} –{" "}
                    {rank.maxXp === null
                      ? "∞"
                      : rank.maxXp.toLocaleString()}{" "}
                    XP
                  </div>
                </div>
              </div>
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{ borderColor: `${accent}66`, color: accent }}
              >
                Tier {rank.tier}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{rank.description}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Capabilities unlocked by tier</h3>
        <p className="text-sm text-muted-foreground">
          Each rank unlocks a specific set of platform actions. Hit the
          threshold and the capabilities below open up automatically — no
          claim flow, no waiting.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Unlocks at</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_GATES.map((gate) => {
                const tierRank = RANKS.find((r) => r.tier === gate.minTier);
                return (
                  <tr key={gate.capability} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <div className="font-medium">{gate.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {gate.description}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <Badge
                        variant="outline"
                        className="text-[10px] whitespace-nowrap"
                        style={{
                          borderColor: tierRank
                            ? `${tierRank.color}66`
                            : `${accent}66`,
                          color: tierRank ? tierRank.color : accent,
                        }}
                      >
                        Tier {gate.minTier} · {tierRank?.name ?? ""}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function CreditsSection() {
  const accent = accentFor("credits");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="credits"
        title="Credits — The Prediction Currency"
        subtitle="Virtual currency you spend to place predictions. Easier to spend than to earn — that's by design."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatPill
          label="Signup grant"
          value={SIGNUP_CREDIT_GRANT.toLocaleString("en-US")}
          accent={accent}
        />
        <StatPill label="Spend on" value="Predictions" accent={accent} />
        <StatPill label="Earn back via" value="Wins + Engagement" accent={accent} />
      </div>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Where Credits come from</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Signup grant.</strong> Every
            new account starts with{" "}
            {SIGNUP_CREDIT_GRANT.toLocaleString("en-US")} Credits so you can
            place predictions immediately.
          </li>
          <li>
            <strong className="text-foreground">Prediction payouts.</strong>{" "}
            Winning predictions return Credits to your balance when the
            market settles, plus your share of the pool.
          </li>
          <li>
            <strong className="text-foreground">Engagement earn loop.</strong>{" "}
            Cast votes, post insights, comment, and hit streak milestones to
            earn small top-ups (see the table below).
          </li>
          <li>
            <strong className="text-foreground">Approved suggestions.</strong>{" "}
            Suggest a candidate or a market — if it goes live, you earn a
            larger one-off bounty.
          </li>
          <li>
            <strong className="text-foreground">Purchase.</strong> Buy more
            from the{" "}
            <a className="underline" href="/pricing">
              pricing page
            </a>{" "}
            (this is our phase-1 revenue model).
          </li>
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Where Credits go</h3>
        <p className="text-sm text-muted-foreground">
          Every prediction deducts Credits from your balance the moment you
          place it. Your stake size is your call — if you win, Credits return
          to your balance plus your share of the pool.
        </p>
      </Card>

      <CreditEarnTable accent={accent} />
    </section>
  );
}

const CREDIT_CATEGORY_LABELS: Record<CreditCategory, string> = {
  ENGAGEMENT: "Engagement",
  QUALITY: "Quality",
  STREAK: "Streak milestones",
  SOCIAL: "Social",
  PROFILE: "Profile completion",
  SPECIAL: "Special",
};

/**
 * Live earn-loop table sourced from shared/credit-config.ts. The
 * SPECIAL category (signup grant, admin adjustment) is intentionally
 * omitted from the user-facing table — those rows are bookkeeping
 * for the admin Credit Actions screen, not actions a user can earn.
 */
function CreditEarnTable({ accent }: { accent: string }) {
  const grouped = (() => {
    const map = new Map<CreditCategory, CreditActionConfig[]>();
    for (const action of CREDIT_ACTIONS) {
      if (!action.isActive) continue;
      if (action.category === CREDIT_CATEGORIES.SPECIAL) continue;
      const list = map.get(action.category) ?? [];
      list.push(action);
      map.set(action.category, list);
    }
    return Array.from(map.entries());
  })();

  return (
    <Card
      className="space-y-3 p-4"
      style={{
        borderColor: `${accent}66`,
        backgroundColor: `${accent}0F`,
      }}
    >
      <h3 className="font-semibold">Earn Credits by participating</h3>
      <p className="text-sm text-muted-foreground">
        Engagement actions earn small daily-capped top-ups. Approved
        suggestions and streak milestones pay out larger one-offs. Values
        below are live — admins can tune them at any time.
      </p>

      {grouped.map(([category, actions]) => (
        <div key={category} className="space-y-2">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            {CREDIT_CATEGORY_LABELS[category]}
          </p>
          <div
            className="overflow-hidden rounded-lg border"
            style={{ borderColor: `${accent}40` }}
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium text-right">Credits</th>
                  <th className="px-3 py-2 font-medium text-right">Daily cap</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr
                    key={action.key}
                    className="border-t border-border/60 align-top"
                    data-testid={`credit-earn-row-${action.key}`}
                  >
                    <td className="px-3 py-2 font-medium">{action.label}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="font-mono text-xs font-semibold"
                        style={{ color: accent }}
                      >
                        +{action.proposedCredits}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                      {action.dailyCap === null ? "No cap" : `${action.dailyCap}/day`}
                    </td>
                    <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                      {action.notes ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Approval-gated rows ship with anti-spam controls — you only earn
        once a moderator approves the suggestion.
      </p>
      {(() => {
        // Derive the referral copy from credit-config so this card and
        // ReferAFriendCard stay in lockstep with the actual server-side
        // award amounts (no more "500/2,000" magic numbers drifting from
        // the live values).
        const referralReward =
          CREDIT_ACTIONS.find((a) => a.key === "referral_completed")
            ?.proposedCredits ?? 0;
        const referralBonus =
          CREDIT_ACTIONS.find((a) => a.key === "referral_signup_bonus")
            ?.proposedCredits ?? 0;
        const headStart = SIGNUP_CREDIT_GRANT + referralBonus;
        const f = (n: number) => n.toLocaleString("en-US");
        return (
          <p className="text-xs text-muted-foreground">
            Share any VoxDex card or page to earn Credits when someone
            follows your link. Refer a friend and earn {f(referralReward)}{" "}
            Credits when they make their first move — they get{" "}
            {f(headStart)} Credits to start ({f(SIGNUP_CREDIT_GRANT)} signup
            grant + {f(referralBonus)} bonus).
          </p>
        );
      })()}
    </Card>
  );
}

type RarityFilter = "ALL" | "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

function BadgesSection() {
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("ALL");

  const visibleBadges = useMemo(
    () =>
      BADGES.filter((b) => b.visibleOnFrontend && b.isActive).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    [],
  );

  const filtered = useMemo(
    () =>
      rarityFilter === "ALL"
        ? visibleBadges
        : visibleBadges.filter((b) => b.rarity === rarityFilter),
    [visibleBadges, rarityFilter],
  );

  const grouped = useMemo(() => {
    const order: BadgeCategory[] = [
      "VOTING",
      "PREDICTION",
      "CONTENT",
      "STREAK",
      "SOCIAL",
      "PROFILE",
      "SPECIAL",
    ];
    return order
      .map((category) => ({
        category,
        rows: filtered.filter((row) => row.category === category),
      }))
      .filter((g) => g.rows.length > 0);
  }, [filtered]);

  const rarityAccent: Record<string, string> = {
    COMMON: "#94A3B8",
    RARE: "#3C83F6",
    EPIC: "#8B5CF6",
    LEGENDARY: "#F59E0B",
  };

  const rarityLabel: Record<string, string> = {
    COMMON: "Common",
    RARE: "Rare",
    EPIC: "Epic",
    LEGENDARY: "Legendary",
  };

  return (
    <section className="space-y-6">
      <SectionHeading
        id="badges"
        title="Badges — Achievements & Milestones"
        subtitle="A collectible record of what you've done — earned automatically as you vote, predict, comment, and engage. Distinct from your rank, which tracks overall standing."
      />

      <div className="flex flex-wrap gap-2">
        <Badge
          variant="outline"
          onClick={() => setRarityFilter("ALL")}
          className={cn(
            "cursor-pointer text-[11px]",
            rarityFilter === "ALL" && "ring-2 ring-primary",
          )}
        >
          All ({visibleBadges.length})
        </Badge>
        {(["COMMON", "RARE", "EPIC", "LEGENDARY"] as const).map((rarity) => {
          const count = visibleBadges.filter((b) => b.rarity === rarity).length;
          return (
            <Badge
              key={rarity}
              variant="outline"
              onClick={() => setRarityFilter(rarity)}
              className={cn(
                "cursor-pointer text-[11px]",
                rarityFilter === rarity && "ring-2 ring-primary",
              )}
              style={{
                borderColor: `${rarityAccent[rarity]}66`,
                color: rarityAccent[rarity],
              }}
            >
              {rarityLabel[rarity]} ({count})
            </Badge>
          );
        })}
      </div>

      {grouped.map(({ category, rows }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {BADGE_CATEGORY_LABELS[category]}
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((row) => (
              <Card key={row.key} className="space-y-1.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium">{row.name}</div>
                  <Badge
                    variant="outline"
                    className="text-[10px] shrink-0"
                    style={{
                      borderColor: `${rarityAccent[row.rarity]}66`,
                      color: rarityAccent[row.rarity],
                    }}
                  >
                    {rarityLabel[row.rarity]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.description}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {BADGE_CATEGORY_LABELS[category]}
                </p>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const BADGE_CATEGORY_LABELS: Record<BadgeCategory, string> = {
  VOTING: "Voting",
  PREDICTION: "Prediction",
  CONTENT: "Content",
  STREAK: "Streak",
  SOCIAL: "Social",
  PROFILE: "Profile",
  SPECIAL: "Special",
};

function VoteSection({
  onJumpToTab,
}: {
  onJumpToTab: (tab: KnowledgeTabId) => void;
}) {
  const accent = accentFor("vote");
  // Live values from the canonical configs so a future seed change
  // (XP rebalance, vote_any credit bump) flows through automatically.
  const voteCreditAction = CREDIT_ACTIONS.find((a) => a.key === "vote_any");
  const submitSuggestionXp = XP_ACTIONS.find(
    (a) => a.actionKey === "submit_suggestion",
  );
  const suggestionApprovedXp = XP_ACTIONS.find(
    (a) => a.actionKey === "suggestion_approved",
  );
  const suggestionApprovedCredits = CREDIT_ACTIONS.find(
    (a) => a.key === "suggestion_approved",
  );
  return (
    <section className="space-y-6">
      <SectionHeading
        id="vote"
        title="Vote — Shape the Conversation"
        subtitle="Voting is the most XP-rewarded surface on VoxDex. Every vote is recorded and contributes to leaderboard signal."
      />

      <p className="text-xs text-muted-foreground -mt-3">
        Every vote earns XP and Credits — see the{" "}
        <button
          type="button"
          onClick={() => onJumpToTab("xp")}
          className="underline-offset-2 hover:underline text-foreground/80"
        >
          XP tab
        </button>{" "}
        and{" "}
        <button
          type="button"
          onClick={() => onJumpToTab("credits")}
          className="underline-offset-2 hover:underline text-foreground/80"
        >
          Credits tab
        </button>{" "}
        for full earn rates and daily limits.
      </p>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Vote surfaces</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Where</th>
                <th className="px-3 py-2 font-medium text-right">XP</th>
                <th className="px-3 py-2 font-medium text-right">Cap</th>
                <th className="px-3 py-2 font-medium text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {VOTE_SURFACES.map((row) => {
                const xp = XP_ACTIONS.find(
                  (action) => action.actionKey === row.xpActionKey,
                );
                return (
                  <tr key={row.surface} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2 font-medium">{row.surface}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.where}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="font-mono font-semibold"
                        style={{ color: accent }}
                      >
                        +{xp?.xpValue ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatCap(xp?.dailyCap ?? null)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono font-semibold text-violet-500 dark:text-violet-300">
                        +{voteCreditAction?.proposedCredits ?? 2} cr
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Credit cap is shared across all vote types — max{" "}
          {voteCreditAction?.dailyCap ?? 10} votes earn Credits per day.
        </p>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Induction and Image Curation votes require{" "}
          <button
            type="button"
            onClick={() => onJumpToTab("ranks")}
            className="underline-offset-2 hover:underline text-foreground/80"
          >
            Aspirant rank
          </button>{" "}
          (Tier 2 — 1,000 XP) or above. Reach Aspirant to unlock these surfaces.
        </p>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Suggesting new vote content</h3>
        <p className="text-sm text-muted-foreground">
          Submit matchups, sentiment polls, opinion polls, induction
          candidates, or profile images for admin review. You earn{" "}
          <span className="font-mono" style={{ color: accent }}>
            +{submitSuggestionXp?.xpValue ?? 5} XP
          </span>{" "}
          for the submission (capped at {submitSuggestionXp?.dailyCap ?? 3} /
          day) and a{" "}
          <span className="font-mono" style={{ color: accent }}>
            +{suggestionApprovedXp?.xpValue ?? 50} XP
          </span>{" "}
          bonus when it&apos;s approved and goes live.
        </p>
        <p className="text-xs text-muted-foreground">
          Approval-gating protects against suggestion spam — only quality
          submissions earn the bonus. Approved vote suggestions also earn{" "}
          <span className="font-mono text-violet-500 dark:text-violet-300">
            +{suggestionApprovedCredits?.proposedCredits ?? 50} Credits
          </span>{" "}
          with no daily cap.
        </p>
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="font-semibold">Voting Badges</h3>
        <p className="text-sm text-muted-foreground">
          Cast votes to unlock 10 voting badges — from First Vote to Legend
          of the Ballot (10,000 votes). Rarer badges track your consistency
          across different vote types.
        </p>
        <button
          type="button"
          onClick={() => onJumpToTab("badges")}
          className="text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: accent }}
          data-testid="link-vote-badges"
        >
          See all voting badges →
        </button>
      </Card>
    </section>
  );
}

function PredictSection({
  onJumpToTab,
}: {
  onJumpToTab: (tab: KnowledgeTabId) => void;
}) {
  const accent = accentFor("predict");
  // Live values from the catalogue. predictionWinXp drives the "+100 XP"
  // bullet copy below so a future rebalance flows through automatically.
  const predictionWinXp = XP_ACTIONS.find(
    (a) => a.actionKey === "prediction_win",
  );
  // Credit reads for the surface-level Credits column. We hardcode
  // the row→action mapping (not data-driven from PREDICT_SURFACES)
  // because place_prediction has no credit row by design — it costs
  // credits, doesn't earn them.
  const marketSuggestionCredits = CREDIT_ACTIONS.find(
    (a) => a.key === "market_suggestion_approved",
  );

  /** Per-row credit cell. Returns either an earn pill, a "—" with
   *  helper text, or a payout label depending on the row. */
  const creditCellFor = (xpActionKey: string): JSX.Element => {
    if (xpActionKey === "place_prediction") {
      return (
        <span className="text-xs text-muted-foreground">Costs Credits to stake</span>
      );
    }
    if (xpActionKey === "prediction_win") {
      return (
        <span className="text-xs font-medium text-violet-500 dark:text-violet-300">
          Payout returned
        </span>
      );
    }
    if (xpActionKey === "market_suggestion_approved") {
      return (
        <span className="font-mono font-semibold text-violet-500 dark:text-violet-300">
          +{marketSuggestionCredits?.proposedCredits ?? 100} cr
        </span>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <section className="space-y-6">
      <SectionHeading
        id="predict"
        title="Predict — Stake Your Take"
        subtitle="Spend Credits to predict outcomes. Win Credits + bonus XP when you're right."
      />

      <p className="text-xs text-muted-foreground -mt-3">
        Credits power every prediction — see the{" "}
        <button
          type="button"
          onClick={() => onJumpToTab("credits")}
          className="underline-offset-2 hover:underline text-foreground/80"
        >
          Credits tab
        </button>{" "}
        for earn rates, signup grants, and purchase options.
      </p>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">How prediction markets work</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            Most markets are <strong className="text-foreground">live-price markets</strong>: you buy
            shares of an outcome at the current price, and each winning share
            pays{" "}
            <strong className="text-foreground">1 Credit</strong> when the
            market settles. Prices reflect the crowd's view of the odds — a
            0.30 cr share implies a ~30% chance.
          </li>
          <li>
            <strong className="text-foreground">Cheaper shares pay bigger multiples</strong>{" "}
            if your side wins. A contrarian pick at 0.20 cr pays 5× per share;
            the heavy favourite at 0.80 cr pays only 1.25×. Sell anytime
            before close to lock in profits or cut losses.
          </li>
          <li>
            The <strong className="text-foreground">Weekly Jackpot</strong> is
            the exception — it's a single shared pool that goes to whoever
            guesses the closing Trend Score closest at Sunday close.
          </li>
          <li>
            Your stake is debited from your Credits balance the moment you
            place the prediction.
          </li>
          <li>
            When the market resolves, the resolver settles winning positions —
            payout returns Credits to your balance and awards{" "}
            <span className="font-mono" style={{ color: accent }}>
              +{predictionWinXp?.xpValue ?? 100} XP
            </span>{" "}
            for the win.
          </li>
        </ul>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Predict surfaces</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Where</th>
                <th className="px-3 py-2 font-medium text-right">XP</th>
                <th className="px-3 py-2 font-medium text-right">Cap</th>
                <th className="px-3 py-2 font-medium text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {PREDICT_SURFACES.map((row) => {
                const xp = XP_ACTIONS.find(
                  (action) => action.actionKey === row.xpActionKey,
                );
                return (
                  <tr key={row.surface} className="border-t border-border/60 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.surface}</div>
                      {row.notes && (
                        <div className="text-xs text-muted-foreground">
                          {row.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{row.where}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="font-mono font-semibold"
                        style={{ color: accent }}
                      >
                        +{xp?.xpValue ?? 0}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatCap(xp?.dailyCap ?? null)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {creditCellFor(row.xpActionKey)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          When your suggested world market is approved and published,
          you&apos;ll earn{" "}
          <span className="font-mono" style={{ color: accent }}>
            +100 XP
          </span>{" "}
          and{" "}
          <span className="font-mono text-violet-500 dark:text-violet-300">
            +{marketSuggestionCredits?.proposedCredits ?? 100} Credits
          </span>{" "}
          when your market goes live. World markets carry the most editorial
          weight on VoxDex — only the best suggestions make it through.
        </p>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">
              Advanced prediction markets unlock at{" "}
              <button
                type="button"
                onClick={() => onJumpToTab("ranks")}
                className="underline-offset-2 hover:underline text-foreground/80"
              >
                Analyst rank
              </button>{" "}
              (Tier 4 — 15,000 XP). Higher-stakes markets are reserved for
              credentialed predictors.
            </p>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-300"
          >
            Coming soon
          </Badge>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <h3 className="font-semibold">Prediction Badges</h3>
        <p className="text-sm text-muted-foreground">
          Win predictions to unlock 7 prediction badges — from First Win to
          Oracle (70%+ win rate across 50+ predictions). Consistent
          forecasters unlock the rarest tiers.
        </p>
        <button
          type="button"
          onClick={() => onJumpToTab("badges")}
          className="text-xs font-medium underline-offset-2 hover:underline"
          style={{ color: accent }}
          data-testid="link-predict-badges"
        >
          See all prediction badges →
        </button>
      </Card>
    </section>
  );
}

type SectionRenderer = (props: {
  onJumpToTab: (tab: KnowledgeTabId) => void;
}) => JSX.Element;

const SECTION_BY_TAB: Record<KnowledgeTabId, SectionRenderer> = {
  xp: ({ onJumpToTab }) => <XpSection onJumpToTab={onJumpToTab} />,
  ranks: () => <RanksSection />,
  credits: () => <CreditsSection />,
  badges: () => <BadgesSection />,
  vote: ({ onJumpToTab }) => <VoteSection onJumpToTab={onJumpToTab} />,
  predict: ({ onJumpToTab }) => <PredictSection onJumpToTab={onJumpToTab} />,
};

export default function HowItWorksPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<KnowledgeTabId>("xp");

  const ActiveSection = SECTION_BY_TAB[activeTab];

  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 items-center gap-4 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else setLocation("/me");
            }}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <div>
              <h1 className="font-semibold">How It Works</h1>
              <p className="text-xs text-muted-foreground">
                The VoxDex gamification knowledge base
              </p>
            </div>
          </div>
        </div>
      </header>

      <div
        id="profile-tabs-section"
        className="sticky top-14 z-40 border-b bg-background/80 backdrop-blur-xl"
      >
        <div className="container mx-auto max-w-3xl px-2 py-2 sm:px-4">
          <KnowledgeTabsBar
            tabs={KNOWLEDGE_TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
      </div>

      <div className="container mx-auto max-w-3xl space-y-6 px-2 py-6 sm:px-4">
        <Card className="flex items-start gap-3 p-4">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="text-sm text-muted-foreground">
            This page is the canonical reference for how VoxDex rewards
            participation. Pick a tab above to dig into XP, Ranks, Credits,
            Badges, Voting, or Predictions. Numbers shown here mirror the
            server-side configuration.
          </p>
        </Card>

        <ActiveSection onJumpToTab={setActiveTab} />

        <Separator />

        <p className="text-center text-xs text-muted-foreground">
          Want to suggest a tweak to how rewards work?{" "}
          <a className="underline" href="/contact">
            Drop us a note
          </a>
          .
        </p>
      </div>
    </div>
  );
}
