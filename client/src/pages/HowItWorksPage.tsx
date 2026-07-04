import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  Coins,
  Flame,
  Gauge,
  Gift,
  HelpCircle,
  Info,
  Scale,
  Send,
  ShoppingCart,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { BadgeCardData } from "@/components/BadgeCard";
import {
  STREAK_MILESTONES,
  STREAK_MILESTONE_XP,
} from "@shared/streak-config";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useUserStats } from "@/hooks/useGamification";
import { useScrollToHash } from "@/hooks/useScrollToHash";
import { useAuth } from "@/contexts/AuthContext";
import {
  KNOWLEDGE_TABS,
  KNOWLEDGE_NAV_TAB_ORDER,
  XP_ACTIONS,
  RANKS,
  VOTE_SURFACES,
  PREDICT_SURFACES,
  glowClassFor,
  getRankConfig,
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
import {
  PROFILE_BANNER_MIN_TIER,
  PROFILE_THEME_MIN_TIER,
} from "@shared/profile-theme-config";
import { cn } from "@/lib/utils";
import { CURRENCY, formatVox } from "@/lib/currency";
import { SwipeNavigator } from "@/components/vote/SwipeNavigator";
import { ReferAFriendCard } from "@/components/ReferAFriendCard";
import { REFERRAL_PANEL_GLOW_CLASS } from "@/components/referral/ReferralFriendPanel";
import { navigateToLogin } from "@/lib/authReturn";
import { HowItWorksWelcomeModal } from "@/components/HowItWorksWelcomeModal";
import type { OnboardingDrawerHandle } from "@/components/OnboardingDrawer";

/**
 * Tier at which a member's rank qualifier starts appearing inline on their
 * comments and insights — mirrors RANK_QUALIFIER_MIN_TIER in CommentRow.
 */
const RANK_QUALIFIER_MIN_TIER = 3;

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

/**
 * Scroll offset for hash anchors on this page (#earn-vox, #streak).
 *
 * How It Works stacks TWO sticky bars — the h-14 page header (56px) and
 * the sticky knowledge tab bar (~66px incl. padding) — so anchored
 * sections need ~122px of clearance before the heading is visible,
 * plus breathing room so the heading doesn't sit flush against the bar.
 * Applied as an inline style because the global
 * `[data-hash-anchor] { scroll-margin-top: 72px }` rule in index.css
 * out-cascades Tailwind `scroll-mt-*` utilities (same specificity,
 * later in the sheet).
 */
const HIW_HASH_ANCHOR_OFFSET = 144;

/**
 * Shared knowledge-base table cell classes. Header cells are vertically
 * centered with the same row height as body cells (matches the XP-tab
 * polish) so every table on the page reads consistently.
 */
const KB_TH = "py-3.5 align-middle font-medium leading-normal";
const KB_TD = "px-3 py-3.5 align-middle";

/** Neutral slate accent for XP-tab concept tiles — the XP chrome is
 * white/neutral, so a fixed slate reads in both light and dark themes. */
const XP_TILE_ACCENT = "#64748B";

/**
 * Elegant, scannable concept tile — an icon chip, a short bold label, and a
 * one-line description. Replaces dense bullet lists in the "general info"
 * containers so they're easy to grasp at a glance.
 */
function ConceptTile({
  icon: Icon,
  label,
  accent,
  children,
}: {
  icon: LucideIcon;
  label: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `linear-gradient(135deg, ${accent}33 0%, ${accent}1a 100%)`,
          border: `1px solid ${accent}59`,
        }}
      >
        <Icon className="h-4 w-4" style={{ color: accent }} strokeWidth={2} />
      </span>
      <div className="min-w-0 space-y-0.5 leading-snug">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/**
 * Consistent informational callout used across the Vote / Predict toggles.
 * A clean tinted left accent border (no floating icon) keeps the emphasis
 * subtle and consistent with the page's glow language.
 */
function InfoCallout({
  accent,
  children,
}: {
  accent?: string;
  children: ReactNode;
}) {
  return (
    <Card
      className={cn("border-l-2 p-4", !accent && "border-l-border")}
      style={accent ? { borderLeftColor: accent } : undefined}
    >
      <div className="min-w-0 space-y-1 text-sm text-muted-foreground">
        {children}
      </div>
    </Card>
  );
}

/**
 * Glowing hero container that opens each tab. Carries the per-tab pulse-card
 * glow (color keyed to the active tab, mirroring the Insights page) and
 * optionally wraps lead content like the stat-pill row. Uses pulse-card-flush
 * so the large static header glows without the small-tile hover lift.
 */
function SectionHeading({
  id,
  title,
  subtitle,
  children,
}: {
  id: KnowledgeTabId;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "space-y-4 rounded-xl p-4 sm:p-5",
        glowClassFor(id),
        "pulse-card-flush",
      )}
    >
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
      {children}
    </section>
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

function XpActionLabel({
  actionKey,
  displayName,
}: {
  actionKey: string;
  displayName: string;
}) {
  if (actionKey === "market_suggestion_approved") {
    return (
      <>
        Market Suggestion
        <br />
        Approved
      </>
    );
  }
  return displayName;
}

function XpActionTable({
  rows,
  glowClass,
  xpValueClass,
}: {
  rows: XpActionRow[];
  glowClass?: string;
  xpValueClass?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl",
        glowClass ? cn(glowClass, "pulse-card-flush") : "border",
      )}
    >
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground align-middle">
            <th className={cn("font-medium", XP_TABLE_HEADER_CELL, XP_TABLE_ACTION_PAD, XP_TABLE_COL.action)}>
              Action
            </th>
            <th className={cn("px-3 font-medium text-right", XP_TABLE_HEADER_CELL, XP_TABLE_COL.xp)}>
              XP
            </th>
            <th
              className={cn(
                "px-3 font-medium text-right",
                XP_TABLE_HEADER_CELL,
                XP_TABLE_COL.dailyCap,
              )}
            >
              Daily Cap
            </th>
            <th className={cn("px-3 font-medium", XP_TABLE_HEADER_CELL, XP_TABLE_COL.notes)}>
              Notes
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.actionKey}
              className="border-t border-border/60 align-middle"
            >
              <td className={cn("py-3.5", XP_TABLE_ACTION_PAD, XP_TABLE_COL.action)}>
                <div className="font-medium leading-snug">
                  <XpActionLabel actionKey={row.actionKey} displayName={row.displayName} />
                </div>
              </td>
              <td className={cn("px-3 py-3.5 text-right", XP_TABLE_COL.xp)}>
                <span
                  className={cn(
                    "font-mono font-semibold",
                    xpValueClass ?? "text-slate-700 dark:text-white",
                  )}
                >
                  {row.xpValue > 0 ? `+${row.xpValue}` : row.xpValue}
                </span>
              </td>
              <td className={cn("px-3 py-3.5 text-right text-muted-foreground", XP_TABLE_COL.dailyCap)}>
                {formatCap(row.dailyCap)}
              </td>
              <td className={cn("px-3 py-3.5 text-muted-foreground", XP_TABLE_COL.notes)}>
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

/**
 * Per-category glow skin for the XP action tables — each section borrows
 * its surface's theme colour (the same `.pulse-card-*` skins used by the
 * section heroes). `pulse-card-blue` is the neutral/white skin, so Streak
 * uses `pulse-card-voxdex` for the standard VoxDex blue.
 */
const XP_CATEGORY_GLOW: Record<XpActionRow["category"], string> = {
  Voting: "pulse-card-cyan",
  Content: "pulse-card-amber",
  Engagement: "pulse-card-amber",
  Prediction: "pulse-card-purple",
  Streak: "pulse-card-voxdex",
  Special: "",
};

/** Per-category tint for XP column values — matches each container's theme. */
const XP_CATEGORY_XP_COLOR: Record<XpActionRow["category"], string> = {
  Voting: "text-cyan-600 dark:text-cyan-400",
  Content: "text-amber-600 dark:text-amber-400",
  Engagement: "text-amber-600 dark:text-amber-400",
  Prediction: "text-violet-600 dark:text-violet-400",
  Streak: "text-blue-600 dark:text-blue-400",
  Special: "text-slate-700 dark:text-white",
};

/**
 * Shared column widths — applied to every XpActionTable th/td so all five
 * category tables line up vertically on the page. Rem-based (not %) so the
 * Action column hugs the longest label without a dead gap before XP.
 */
const XP_TABLE_COL = {
  action: "w-[11rem] sm:w-[12rem] md:w-[12.5rem] whitespace-nowrap",
  xp: "w-[3rem] sm:w-[3.25rem] md:w-[3.5rem] whitespace-nowrap",
  dailyCap: "w-[4.5rem] sm:w-[5rem] md:w-[5.5rem] whitespace-nowrap",
  notes: "hidden md:table-cell",
} as const;

const XP_TABLE_ACTION_PAD = "pl-5 pr-3";

const XP_TABLE_HEADER_CELL = "py-3.5 align-middle leading-normal";

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
      >
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
      </SectionHeading>

      <RankLadderStrip onJumpToRanks={() => onJumpToTab?.("ranks")} />

      <Card className={cn("space-y-4 p-4 sm:p-5 shadow-none", glowClassFor("xp"), "pulse-card-flush")}>
        <div className="space-y-1">
          <h3 className="font-semibold">How XP is awarded</h3>
          <p className="text-sm text-muted-foreground">
            Earn XP for everything you do on VoxDex — it adds up and lifts your
            rank.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ConceptTile icon={Sparkles} label="Everything counts" accent={XP_TILE_ACCENT}>
            Votes, predictions, comments, and streaks all earn XP.
          </ConceptTile>
          <ConceptTile icon={Check} label="Once per event" accent={XP_TILE_ACCENT}>
            Each action awards XP once — no double credit, even if something
            errors on our end.
          </ConceptTile>
          <ConceptTile icon={Gauge} label="Daily limits" accent={XP_TILE_ACCENT}>
            Most actions cap per day to keep it fair. Hit a cap and other
            actions still count; resets midnight UTC.
          </ConceptTile>
          <ConceptTile icon={Trophy} label="Automatic rank-ups" accent={XP_TILE_ACCENT}>
            Cross a rank threshold and your rank updates automatically —
            you&apos;ll get a notification.
          </ConceptTile>
        </div>
      </Card>

      {grouped.map(({ category, rows }) => (
        <div
          key={category}
          className="space-y-2"
          {...(category === "Streak"
            ? {
                id: "streak",
                "data-hash-anchor": true,
                // See the #earn-vox anchor for why this is an inline
                // style rather than a scroll-mt-* utility.
                style: { scrollMarginTop: HIW_HASH_ANCHOR_OFFSET },
              }
            : {})}
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <XpActionTable
            rows={rows}
            glowClass={XP_CATEGORY_GLOW[category]}
            xpValueClass={XP_CATEGORY_XP_COLOR[category]}
          />
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
 * Rounded-square icon chip for a rank — the rank's own Lucide glyph tinted in
 * its tier colour. Replaces the old flat numbered circle; the tier number now
 * lives in the tile label as "Tier N". Two sizes: the compact ladder strip
 * (sm) and the larger Ranks-tab detail cards (lg).
 */
function RankIconChip({
  rank,
  size = "sm",
}: {
  rank: (typeof RANKS)[number];
  size?: "sm" | "lg";
}) {
  const Icon = getRankConfig(rank.name).icon;
  const box = size === "lg" ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-lg";
  const glyph = size === "lg" ? "h-5 w-5" : "h-4 w-4";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", box)}
      style={{
        background: `linear-gradient(135deg, ${rank.color}33 0%, ${rank.color}1a 100%)`,
        border: `1px solid ${rank.color}59`,
      }}
    >
      <Icon className={glyph} style={{ color: rank.color }} strokeWidth={2} />
    </span>
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
        data-no-tab-swipe
      >
        {RANKS.map((rank) => {
          const isCurrent = currentTier === rank.tier;
          return (
            <div
              key={rank.tier}
              data-testid={`rank-ladder-tier-${rank.tier}`}
              className={cn(
                "shrink-0 md:shrink min-w-[110px] md:min-w-0 rounded-lg px-2.5 py-2.5 md:px-3 md:py-3 transition-colors",
                isCurrent
                  ? "rank-glow"
                  : "border border-border/60 bg-muted/30",
              )}
              style={
                isCurrent
                  ? ({ "--rank-color": rank.color } as CSSProperties)
                  : undefined
              }
            >
              <div className="flex items-center gap-2.5 md:flex-col md:items-center md:gap-2 md:text-center">
                <RankIconChip rank={rank} />
                <div className="min-w-0 leading-tight md:w-full">
                  <p className="truncate md:whitespace-normal md:line-clamp-2 md:text-balance text-[13px] font-bold">
                    {rank.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="uppercase tracking-wide">Tier {rank.tier}</span>
                    <span className="mx-1 opacity-50">·</span>
                    <span className="font-mono">{rank.minXp.toLocaleString()} XP</span>
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
    <Card className={cn("space-y-4 p-4 shadow-none", "pulse-card-voxdex", "pulse-card-flush")}>
      <div className="flex items-start gap-3">
        <Flame className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="space-y-1">
          <h4 className="font-semibold text-base">How streaks work</h4>
          <ul className="space-y-1.5 text-sm text-muted-foreground list-disc pl-5">
            <li>Log in every day to build your streak.</li>
            <li>
              Your streak is the number of consecutive days you've been active
              on VoxDex.
            </li>
            <li>
              Miss a day and your streak resets to 1.
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-border/60 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
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
              <span className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
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

/**
 * Short summary of the status / visibility unlocks a tier carries. Tier
 * thresholds are the same ones enforced elsewhere: the inline rank
 * qualifier on comments (Tier 3+), the custom profile banner
 * (PROFILE_BANNER_MIN_TIER), and the profile accent theme
 * (PROFILE_THEME_MIN_TIER).
 */
function rankStatusSummary(tier: number): string {
  if (tier >= PROFILE_THEME_MIN_TIER) return "Qualifier · Banner · Theme";
  if (tier >= PROFILE_BANNER_MIN_TIER) return "Qualifier · Banner";
  if (tier >= RANK_QUALIFIER_MIN_TIER) return "Rank qualifier";
  return "Standard profile";
}

function RanksSection() {
  const accent = accentFor("ranks");
  const { isLoggedIn } = useAuth();
  const { data: stats } = useUserStats(isLoggedIn);
  const currentTier = stats?.rank?.tier ?? null;
  return (
    <section className="space-y-6">
      <SectionHeading
        id="ranks"
        title="Ranks — Your VoxDex Reputation"
        subtitle="Everyone can do everything. Rank amplifies it."
      />

      <Card className={cn("space-y-4 p-4 sm:p-5 shadow-none", "pulse-card-voxdex", "pulse-card-flush")}>
        <div className="space-y-1">
          <h3 className="font-semibold">How rank actually works</h3>
          <p className="text-sm text-muted-foreground">
            Everything&apos;s unlocked from day one — rank just{" "}
            <strong className="text-foreground">amplifies</strong> what you
            already do.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <ConceptTile icon={Gauge} label="Earn rate" accent={accent}>
            A per-tier multiplier on the XP and Vox you earn from engagement.
          </ConceptTile>
          <ConceptTile icon={Scale} label="Curatorial influence" accent={accent}>
            How much your Induction and Curate votes count toward winners —
            everyone&apos;s vote still shows as one.
          </ConceptTile>
          <ConceptTile icon={BadgeCheck} label="Status" accent={accent}>
            Visible markers: a rank qualifier, then a custom banner, then a
            profile accent theme.
          </ConceptTile>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {RANKS.map((rank) => {
          const isCurrent = currentTier === rank.tier;
          return (
          <Card
            key={rank.tier}
            data-testid={`rank-card-tier-${rank.tier}`}
            className={cn("space-y-3 p-4", isCurrent && "rank-glow")}
            style={
              isCurrent
                ? ({
                    "--rank-color": rank.color,
                    borderColor: `${rank.color}66`,
                  } as CSSProperties)
                : undefined
            }
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RankIconChip rank={rank} size="lg" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold">{rank.name}</span>
                    {isCurrent && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          backgroundColor: `${rank.color}1f`,
                          color: rank.color,
                          border: `1px solid ${rank.color}59`,
                        }}
                      >
                        Your rank
                      </span>
                    )}
                  </div>
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
                style={{ borderColor: `${rank.color}66`, color: rank.color }}
              >
                Tier {rank.tier}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{rank.description}</p>
            <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Earn rate
                </div>
                <div className="font-mono text-sm font-semibold">
                  {rank.earnMultiplier.toFixed(2)}×
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Curatorial
                </div>
                <div className="font-mono text-sm font-semibold">
                  {rank.curatorialWeight > 1
                    ? `${rank.curatorialWeight.toFixed(2)}×`
                    : "Standard"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Status
                </div>
                <div className="text-[11px] font-medium leading-tight">
                  {rankStatusSummary(rank.tier)}
                </div>
              </div>
            </div>
          </Card>
          );
        })}
      </div>

    </section>
  );
}

/**
 * Referral CTA slot under the "How to earn Vox" header. Logged-in
 * users get the full ReferAFriendCard (personal link + share);
 * logged-out visitors get a matching-glow teaser with a signup CTA
 * so the flagship earn action is visible pre-account.
 */
function EarnVoxReferralSlot() {
  const { isLoggedIn } = useAuth();
  const [, navigate] = useLocation();

  if (isLoggedIn) return <ReferAFriendCard />;

  const referralBonus =
    CREDIT_ACTIONS.find((a) => a.key === "referral_signup_bonus")
      ?.proposedCredits ?? 0;
  const headStart = SIGNUP_CREDIT_GRANT + referralBonus;

  return (
    <Card
      className={cn(REFERRAL_PANEL_GLOW_CLASS, "space-y-3 p-6")}
      data-testid="refer-a-friend-signup-teaser"
    >
      <h3 className="font-semibold">Refer a Friend</h3>
      <p className="text-sm text-muted-foreground">
        Create an account to get your personal referral link. Friends who join
        through it start with {formatVox(headStart)} (
        {formatVox(SIGNUP_CREDIT_GRANT)} signup grant + {formatVox(referralBonus)}{" "}
        bonus) — and you earn Vox when they make their first move.
      </p>
      <Button
        className="w-full sm:w-auto"
        onClick={() => navigateToLogin(navigate, { mode: "signup" })}
        data-testid="button-referral-teaser-signup"
      >
        Create account
      </Button>
    </Card>
  );
}

function CreditsSection() {
  const accent = accentFor("credits");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="credits"
        title="Vox — The Prediction Currency"
        subtitle="Virtual currency you spend to place predictions. Easier to spend than to earn — that's by design."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <StatPill
            label="Signup grant"
            value={formatVox(SIGNUP_CREDIT_GRANT)}
            accent={accent}
          />
          <StatPill label="Spend on" value="Predictions" accent={accent} />
          <StatPill label="Earn back via" value="Wins + Engagement" accent={accent} />
        </div>
      </SectionHeading>

      <InfoCallout accent={accent}>
        <p>
          <strong className="text-foreground">Why virtual currency?</strong>{" "}
          Vox has no cash value and can&apos;t be redeemed or withdrawn. A
          virtual currency means anyone, anywhere can predict without putting
          real money at risk — the platform stays purely entertainment.
        </p>
      </InfoCallout>

      <Card className={cn("space-y-4 p-4 sm:p-5 shadow-none", glowClassFor("credits"), "pulse-card-flush")}>
        <div className="space-y-1">
          <h3 className="font-semibold">How Vox flows</h3>
          <p className="text-sm text-muted-foreground">
            Four ways Vox comes in, one way it goes out.
          </p>
        </div>
        <div>
          <p
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            Coming in
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ConceptTile icon={Gift} label="Signup grant" accent={accent}>
              Every new account starts with {formatVox(SIGNUP_CREDIT_GRANT)} so
              you can predict immediately.
            </ConceptTile>
            <ConceptTile icon={Trophy} label="Prediction payouts" accent={accent}>
              Winning predictions return Vox plus your share of the pool when
              the market settles.
            </ConceptTile>
            <ConceptTile icon={Sparkles} label="Engagement earn loop" accent={accent}>
              Vote, post insights, comment, and hit streak milestones for small
              top-ups (see below).
            </ConceptTile>
            <ConceptTile icon={BadgeCheck} label="Approved suggestions" accent={accent}>
              Suggest a candidate or market — if it goes live, you earn a larger
              one-off bounty.
            </ConceptTile>
          </div>
        </div>
        <div>
          <p
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: accent }}
          >
            Going out
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ConceptTile icon={ShoppingCart} label="Staking on predictions" accent={accent}>
              Every prediction deducts Vox the moment you place it — your stake
              size is your call.
            </ConceptTile>
          </div>
        </div>
      </Card>

      <Separator />

      <div className="space-y-1 pt-1">
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: accent }}
        >
          Earn
        </p>
        <h2 className="text-xl font-semibold tracking-tight">How to earn Vox</h2>
        <p className="text-sm text-muted-foreground">
          Referrals pay the most, then daily engagement — here&apos;s every way
          to top up.
        </p>
      </div>

      <EarnVoxReferralSlot />

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

interface EngagementSectionRow {
  /** Surface name shown in the Section column. */
  name: string;
  /** Credit action key whose live values this row displays. */
  creditKey: string;
  /** Optional per-row clarification (hidden below md). */
  note?: string;
}

interface EngagementBand {
  /** Action heading, e.g. "Vote" / "Post Comment". */
  action: string;
  /** Credit key that carries the band's headline rate + shared cap. */
  creditKey: string;
  /** One-line explainer under the band heading. */
  blurb: string;
  rows: EngagementSectionRow[];
}

/**
 * Display-only breakdown of the three Engagement credit actions into
 * the concrete surfaces users can earn on. The credit keys are still
 * the single source of truth for values and caps (admins tune them in
 * the DB); this metadata just tells users where each action applies.
 *
 * Induction Queue has no comment thread, so it only appears under
 * Vote. Under/Overrated, Curate Profile, and Weekly Up/Down open the
 * celebrity's profile insight thread — noted per row.
 */
const VIA_PROFILE_THREAD = "Via the celebrity's profile thread";

const COMMENT_SECTION_ROWS: EngagementSectionRow[] = [
  {
    name: "Celebrity Profile (insight)",
    creditKey: "comment_insight",
    note: "Comment on any insight thread",
  },
  { name: "Sentiment Poll", creditKey: "comment_insight" },
  { name: "Matchup", creditKey: "comment_insight" },
  { name: "Opinion Poll", creditKey: "comment_insight" },
  { name: "Under/Overrated", creditKey: "comment_insight", note: VIA_PROFILE_THREAD },
  { name: "Curate Profile", creditKey: "comment_insight", note: VIA_PROFILE_THREAD },
  {
    name: "Weekly Up/Down Prediction",
    creditKey: "comment_insight",
    note: VIA_PROFILE_THREAD,
  },
  { name: "World Market Prediction", creditKey: "comment_insight" },
];

const ENGAGEMENT_BANDS: EngagementBand[] = [
  {
    action: "Vote",
    creditKey: "vote_any",
    blurb: "First vote on each item pays — changing your vote doesn't re-pay.",
    rows: [
      { name: "Sentiment Poll", creditKey: "vote_any" },
      { name: "Matchup", creditKey: "vote_any" },
      { name: "Opinion Poll", creditKey: "vote_any" },
      { name: "Under/Overrated", creditKey: "vote_any" },
      { name: "Induction Queue", creditKey: "vote_any" },
      { name: "Curate Profile", creditKey: "vote_any" },
    ],
  },
  {
    action: "Post Insight",
    creditKey: "post_insight",
    blurb: "A top-level post on a celebrity's profile — the highest-paying engagement action.",
    rows: [
      {
        name: "Celebrity Profile (insight)",
        creditKey: "post_insight",
        note: "Also reachable from Under/Overrated, Curate Profile, and Weekly Up/Down cards",
      },
    ],
  },
  {
    action: "Post Comment",
    creditKey: "comment_insight",
    blurb: "Min 20 characters. The daily cap is shared across all comment surfaces.",
    rows: COMMENT_SECTION_ROWS,
  },
  {
    action: "Reply to Comment",
    creditKey: "comment_insight",
    blurb: "Same rate as posting a comment — replies count toward the same daily cap.",
    rows: COMMENT_SECTION_ROWS,
  },
];

function engagementRowTestId(action: string, section: string): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  return `credit-earn-row-${slug(action)}-${slug(section)}`;
}

/**
 * Per-surface Engagement breakdown. Each action gets a sub-band with a
 * headline rate (live from credit config) and a Section table beneath
 * it — Section | Vox | Daily cap | Notes. Notes collapse below md; the
 * column layout stays four-wide so no horizontal scroll is needed on
 * mobile.
 */
function EngagementEarnBands({ accent }: { accent: string }) {
  const byKey = new Map(CREDIT_ACTIONS.map((a) => [a.key, a]));

  return (
    <>
      {ENGAGEMENT_BANDS.map((band, bandIdx) => {
        const bandAction = byKey.get(band.creditKey);
        if (!bandAction) return null;
        return (
          <div key={band.action} className={bandIdx > 0 ? "border-t border-border/60" : undefined}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 pt-4">
              <p className="text-sm font-semibold">{band.action}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono font-semibold" style={{ color: accent }}>
                  +{bandAction.proposedCredits}
                </span>{" "}
                Vox ·{" "}
                {bandAction.dailyCap === null
                  ? "no cap"
                  : `up to ${bandAction.dailyCap}/day (shared cap)`}
              </p>
            </div>
            <p className="px-5 pb-1 text-xs text-muted-foreground">{band.blurb}</p>
            {/* table-fixed + shared colgroup keeps column edges identical
                across all four band tables (auto layout would size each
                band independently and break vertical alignment). */}
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[46%] md:w-[30%]" />
                <col className="w-[22%] md:w-[10%]" />
                <col className="w-[32%] md:w-[14%]" />
                <col className="hidden md:table-column md:w-[46%]" />
              </colgroup>
              <thead>
                <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground align-middle">
                  <th className={cn("pl-5 pr-3", KB_TH)}>Section</th>
                  <th className={cn("px-3 text-right whitespace-nowrap", KB_TH)}>Vox</th>
                  <th className={cn("px-3 text-right whitespace-nowrap", KB_TH)}>
                    Daily cap
                  </th>
                  <th className={cn("px-3 hidden md:table-cell", KB_TH)}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {band.rows.map((row) => {
                  const rowAction = byKey.get(row.creditKey);
                  if (!rowAction) return null;
                  return (
                    <tr
                      key={row.name}
                      className="border-t border-border/60 align-middle"
                      data-testid={engagementRowTestId(band.action, row.name)}
                    >
                      <td className="pl-5 pr-3 py-3.5 align-middle font-medium">
                        {row.name}
                      </td>
                      <td className={cn("text-right", KB_TD)}>
                        <span
                          className="font-mono text-xs font-semibold"
                          style={{ color: accent }}
                        >
                          +{rowAction.proposedCredits}
                        </span>
                      </td>
                      <td className={cn("text-right text-xs text-muted-foreground", KB_TD)}>
                        {rowAction.dailyCap === null
                          ? "No cap"
                          : `${rowAction.dailyCap}/day`}
                      </td>
                      <td className={cn("hidden text-muted-foreground md:table-cell", KB_TD)}>
                        {row.note ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

/**
 * Live earn-loop table sourced from shared/credit-config.ts. The
 * SPECIAL category (signup grant, admin adjustment) is intentionally
 * omitted from the user-facing table — those rows are bookkeeping
 * for the admin Credit Actions screen, not actions a user can earn.
 * The ENGAGEMENT category renders a per-surface breakdown (see
 * EngagementEarnBands); other categories keep the flat action table.
 * (Internal "credit" naming is kept on the file/type; the user-facing
 * label is "Vox".)
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
    // `earn-vox` is a hash-anchor deep-link target
    // (/how-it-works?tab=credits#earn-vox) used by the "Earn Vox" CTAs
    // that replaced the old Buy Vox / pricing entry points.
    //
    // Inline scrollMarginTop (not a Tailwind scroll-mt-*): the global
    // `[data-hash-anchor] { scroll-margin-top: 72px }` rule in index.css
    // is un-layered CSS, so it overrides layered Tailwind utilities.
    // 72px only clears ONE sticky bar; this page stacks two (h-14
    // header + the sticky knowledge tab bar ≈ 118px), which left the
    // heading hidden behind the tab bar. HIW_HASH_ANCHOR_OFFSET clears
    // both bars plus breathing room.
    <div
      className="space-y-4"
      id="earn-vox"
      data-hash-anchor
      style={{ scrollMarginTop: HIW_HASH_ANCHOR_OFFSET }}
    >
      {/* Section title lives above (the "How to earn Vox" header in
          CreditsSection) — this is just the explanatory lead line. */}
      <p className="text-sm text-muted-foreground">
        Engagement actions earn small daily-capped top-ups. Approved
        suggestions and streak milestones pay out larger one-offs. Values
        below are live — admins can tune them at any time.
      </p>

      {grouped.map(([category, actions]) => (
        <div
          key={category}
          className={cn(
            "overflow-hidden rounded-xl",
            glowClassFor("credits"),
            "pulse-card-flush",
          )}
        >
          <div className="px-4 pt-3 pb-1">
            <p
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: accent }}
            >
              {CREDIT_CATEGORY_LABELS[category]}
            </p>
          </div>
          {category === CREDIT_CATEGORIES.ENGAGEMENT ? (
            <EngagementEarnBands accent={accent} />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground align-middle">
                  <th className={cn("pl-5 pr-3", KB_TH)}>Action</th>
                  <th className={cn("px-3 text-right whitespace-nowrap", KB_TH)}>Vox</th>
                  <th className={cn("px-3 text-right whitespace-nowrap", KB_TH)}>
                    Daily cap
                  </th>
                  <th className={cn("px-3 hidden md:table-cell", KB_TH)}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr
                    key={action.key}
                    className="border-t border-border/60 align-middle"
                    data-testid={`credit-earn-row-${action.key}`}
                  >
                    <td className={cn("pl-5 pr-3 py-3.5 align-middle font-medium")}>
                      {action.label}
                    </td>
                    <td className={cn("text-right", KB_TD)}>
                      <span
                        className="font-mono text-xs font-semibold"
                        style={{ color: accent }}
                      >
                        +{action.proposedCredits}
                      </span>
                    </td>
                    <td className={cn("text-right text-xs text-muted-foreground", KB_TD)}>
                      {action.dailyCap === null ? "No cap" : `${action.dailyCap}/day`}
                    </td>
                    <td className={cn("hidden text-muted-foreground md:table-cell", KB_TD)}>
                      {action.notes ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
        return (
          <p className="text-xs text-muted-foreground">
            Share any VoxDex card or page to earn Vox when someone follows
            your link. Refer a friend and earn {formatVox(referralReward)}{" "}
            when they make their first move — they get{" "}
            {formatVox(headStart)} to start ({formatVox(SIGNUP_CREDIT_GRANT)}{" "}
            signup grant + {formatVox(referralBonus)} bonus).
          </p>
        );
      })()}
    </div>
  );
}

type RarityFilter = "ALL" | "COMMON" | "RARE" | "EPIC" | "LEGENDARY";

function BadgesSection() {
  const { isLoggedIn } = useAuth();
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>("ALL");
  const [earnedOnly, setEarnedOnly] = useState(false);

  // Earned state powers the personalised glow + "Earned" chip. Same
  // endpoint the /me/badges trophy cabinet uses, so earned status stays
  // in lockstep. Logged-out visitors just see the full catalogue.
  const { data: earnedData } = useQuery<BadgeCardData[]>({
    queryKey: ["/api/me/badges"],
    enabled: isLoggedIn,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/me/badges");
      return res.json();
    },
  });

  const earnedMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const b of earnedData ?? []) {
      if (b.earned) map.set(b.key, b.earnedAt);
    }
    return map;
  }, [earnedData]);

  const visibleBadges = useMemo(
    () =>
      BADGES.filter((b) => b.visibleOnFrontend && b.isActive).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    [],
  );

  const earnedCount = useMemo(
    () => visibleBadges.filter((b) => earnedMap.has(b.key)).length,
    [visibleBadges, earnedMap],
  );

  const filtered = useMemo(
    () =>
      visibleBadges.filter((b) => {
        if (rarityFilter !== "ALL" && b.rarity !== rarityFilter) return false;
        if (earnedOnly && !earnedMap.has(b.key)) return false;
        return true;
      }),
    [visibleBadges, rarityFilter, earnedOnly, earnedMap],
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

      {isLoggedIn && (
        <p className="text-sm text-muted-foreground -mt-3" data-testid="badges-earned-summary">
          You&apos;ve earned{" "}
          <span className="font-semibold text-foreground">{earnedCount}</span> of{" "}
          {visibleBadges.length} badges.
        </p>
      )}

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
        {isLoggedIn && (
          <Badge
            variant="outline"
            onClick={() => setEarnedOnly((v) => !v)}
            className={cn(
              "cursor-pointer text-[11px] border-emerald-500/40 text-emerald-600 dark:text-emerald-300",
              earnedOnly && "ring-2 ring-emerald-500",
            )}
            data-testid="badges-filter-earned"
          >
            <Check className="mr-1 h-3 w-3" /> Earned ({earnedCount})
          </Badge>
        )}
      </div>

      {grouped.map(({ category, rows }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {BADGE_CATEGORY_LABELS[category]}
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((row) => {
              const isEarned = earnedMap.has(row.key);
              return (
                <Card
                  key={row.key}
                  className={cn("space-y-1.5 p-3", isEarned && "earned-glow")}
                  style={
                    isEarned
                      ? ({ "--glow-color": rarityAccent[row.rarity] } as CSSProperties)
                      : undefined
                  }
                  data-testid={`badge-card-${row.key}`}
                  data-earned={isEarned ? "true" : "false"}
                >
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
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {BADGE_CATEGORY_LABELS[category]}
                    </p>
                    {isEarned && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-300">
                        <Check className="h-3 w-3" /> Earned
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {filtered.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {earnedOnly
            ? "No badges earned in this filter yet — keep participating to unlock them."
            : "No badges match this filter."}
        </Card>
      )}
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
        Every vote earns XP and Vox — see the{" "}
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
          Vox tab
        </button>{" "}
        for full earn rates and daily limits.
      </p>

      <Card className={cn("space-y-3 p-4 shadow-none", glowClassFor("vote"), "pulse-card-flush")}>
        <h3 className="font-semibold">Vote surfaces</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground align-middle">
                <th className={cn("pl-5 pr-3", KB_TH)}>Surface</th>
                <th className={cn("px-3", KB_TH)}>Where</th>
                <th className={cn("px-3 text-right", KB_TH)}>XP</th>
                <th className={cn("px-3 text-right", KB_TH)}>Cap</th>
                <th className={cn("px-3 text-right", KB_TH)}>Vox</th>
              </tr>
            </thead>
            <tbody>
              {VOTE_SURFACES.map((row) => {
                const xp = XP_ACTIONS.find(
                  (action) => action.actionKey === row.xpActionKey,
                );
                return (
                  <tr key={row.surface} className="border-t border-border/60 align-middle">
                    <td className={cn("pl-5 pr-3 py-3.5 align-middle font-medium")}>
                      {row.surface}
                    </td>
                    <td className={cn("text-muted-foreground", KB_TD)}>{row.where}</td>
                    <td className={cn("text-right", KB_TD)}>
                      <span
                        className="font-mono font-semibold"
                        style={{ color: accent }}
                      >
                        +{xp?.xpValue ?? 0}
                      </span>
                    </td>
                    <td className={cn("text-right text-muted-foreground", KB_TD)}>
                      {formatCap(xp?.dailyCap ?? null)}
                    </td>
                    <td className={cn("text-right", KB_TD)}>
                      <span className="font-mono font-semibold text-violet-500 dark:text-violet-300">
                        +{CURRENCY.symbol}{voteCreditAction?.proposedCredits ?? 2}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Vox cap is shared across all vote types — max{" "}
          {voteCreditAction?.dailyCap ?? 10} votes earn Vox per day.
        </p>
      </Card>

      <Card className={cn("space-y-4 p-4 sm:p-5 shadow-none", glowClassFor("vote"), "pulse-card-flush")}>
        <div className="space-y-1">
          <h3 className="font-semibold">Suggesting new vote content</h3>
          <p className="text-sm text-muted-foreground">
            Submit matchups, polls, induction candidates, or profile images for
            review.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <ConceptTile icon={Send} label="You submit" accent={accent}>
            +{submitSuggestionXp?.xpValue ?? 5} XP per submission (capped{" "}
            {submitSuggestionXp?.dailyCap ?? 3}/day).
          </ConceptTile>
          <ConceptTile icon={BadgeCheck} label="It gets approved" accent={accent}>
            +{suggestionApprovedXp?.xpValue ?? 50} XP bonus when it goes live.
          </ConceptTile>
          <ConceptTile icon={Coins} label="Vox bonus" accent={accent}>
            Approved suggestions also earn +{CURRENCY.symbol}
            {suggestionApprovedCredits?.proposedCredits ?? 50}, no daily cap.
          </ConceptTile>
        </div>
        <p className="text-xs text-muted-foreground">
          Approval-gating protects against spam — only quality submissions earn
          the bonus.
        </p>
      </Card>

      <Card className={cn("space-y-2 p-4 shadow-none", glowClassFor("vote"), "pulse-card-flush")}>
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
  // Vox reads for the surface-level Vox column. We hardcode the
  // row→action mapping (not data-driven from PREDICT_SURFACES) because
  // place_prediction has no credit row by design — it costs Vox,
  // doesn't earn it.
  const marketSuggestionCredits = CREDIT_ACTIONS.find(
    (a) => a.key === "market_suggestion_approved",
  );

  /** Per-row Vox cell. Returns either an earn pill, a "—" with helper
   *  text, or a payout label depending on the row. */
  const creditCellFor = (xpActionKey: string): JSX.Element => {
    if (xpActionKey === "place_prediction") {
      return (
        <span className="text-xs text-muted-foreground">Costs Vox to stake</span>
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
          +{CURRENCY.symbol}{marketSuggestionCredits?.proposedCredits ?? 100}
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
        subtitle="Spend Vox to predict outcomes. Win Vox + bonus XP when you're right."
      />

      <p className="text-xs text-muted-foreground -mt-3">
        Vox powers every prediction — see the{" "}
        <button
          type="button"
          onClick={() => onJumpToTab("credits")}
          className="underline-offset-2 hover:underline text-foreground/80"
        >
          Vox tab
        </button>{" "}
        for earn rates and signup grants.
      </p>

      <Card className={cn("space-y-4 p-4 sm:p-5 shadow-none", glowClassFor("predict"), "pulse-card-flush")}>
        <div className="space-y-1">
          <h3 className="font-semibold">How prediction markets work</h3>
          <p className="text-sm text-muted-foreground">
            Buy shares of an outcome at the current price — the crowd&apos;s
            odds. Get it right and each share pays out.
          </p>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <ConceptTile icon={Gauge} label="Live-price shares" accent={accent}>
            Each winning share pays Ꝟ1 at settlement. Price = implied odds — a
            Ꝟ0.30 share means a ~30% chance.
          </ConceptTile>
          <ConceptTile icon={Trophy} label="Cheaper pays bigger" accent={accent}>
            A contrarian pick at Ꝟ0.20 pays 5×; the Ꝟ0.80 favourite pays 1.25×.
            Sell anytime before close.
          </ConceptTile>
          <ConceptTile icon={Sparkles} label="Weekly Jackpot" accent={accent}>
            The exception — one shared pool for whoever guesses the closing
            Trend Score closest at Sunday close.
          </ConceptTile>
          <ConceptTile icon={Coins} label="Stake & settle" accent={accent}>
            Your stake is debited when you place it. Wins return Vox plus{" "}
            <span className="font-mono" style={{ color: accent }}>
              +{predictionWinXp?.xpValue ?? 100} XP
            </span>
            .
          </ConceptTile>
        </div>
      </Card>

      <Card className={cn("space-y-3 p-4 shadow-none", glowClassFor("predict"), "pulse-card-flush")}>
        <h3 className="font-semibold">Predict surfaces</h3>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground align-middle">
                <th className={cn("pl-5 pr-3", KB_TH)}>Surface</th>
                <th className={cn("px-3", KB_TH)}>Where</th>
                <th className={cn("px-3 text-right", KB_TH)}>XP</th>
                <th className={cn("px-3 text-right", KB_TH)}>Cap</th>
                <th className={cn("px-3 text-right", KB_TH)}>Vox</th>
              </tr>
            </thead>
            <tbody>
              {PREDICT_SURFACES.map((row) => {
                const xp = XP_ACTIONS.find(
                  (action) => action.actionKey === row.xpActionKey,
                );
                return (
                  <tr key={row.surface} className="border-t border-border/60 align-middle">
                    <td className={cn("pl-5 pr-3 py-3.5 align-middle")}>
                      <div className="font-medium">{row.surface}</div>
                      {row.notes && (
                        <div className="text-xs text-muted-foreground">
                          {row.notes}
                        </div>
                      )}
                    </td>
                    <td className={cn("text-muted-foreground", KB_TD)}>{row.where}</td>
                    <td className={cn("text-right", KB_TD)}>
                      <span
                        className="font-mono font-semibold"
                        style={{ color: accent }}
                      >
                        +{xp?.xpValue ?? 0}
                      </span>
                    </td>
                    <td className={cn("text-right text-muted-foreground", KB_TD)}>
                      {formatCap(xp?.dailyCap ?? null)}
                    </td>
                    <td className={cn("text-right", KB_TD)}>
                      {creditCellFor(row.xpActionKey)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <InfoCallout accent={accent}>
        <p>
          When your suggested world market is approved and published,
          you&apos;ll earn{" "}
          <span className="font-mono" style={{ color: accent }}>
            +100 XP
          </span>{" "}
          and{" "}
          <span className="font-mono text-violet-500 dark:text-violet-300">
            +{CURRENCY.symbol}{marketSuggestionCredits?.proposedCredits ?? 100}
          </span>{" "}
          when your market goes live. World markets carry the most editorial
          weight on VoxDex — only the best suggestions make it through.
        </p>
      </InfoCallout>

      <InfoCallout accent={accent}>
        <p>
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
        <Badge
          variant="outline"
          className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-300"
        >
          Coming soon
        </Badge>
      </InfoCallout>

      <Card className={cn("space-y-2 p-4 shadow-none", glowClassFor("predict"), "pulse-card-flush")}>
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

const KNOWLEDGE_TAB_IDS = new Set<string>(KNOWLEDGE_TABS.map((tab) => tab.id));

/** Resolve the active tab from the `?tab=` query string (default: xp). */
function parseKnowledgeTab(search: string): KnowledgeTabId {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const tab = params.get("tab");
  if (tab && KNOWLEDGE_TAB_IDS.has(tab)) return tab as KnowledgeTabId;
  return "xp";
}

/**
 * Reflect the active tab into the address bar so a tab can be shared and
 * deep-linked (e.g. /how-it-works?tab=ranks). Mirrors the Insights page
 * pattern: replaceState (no history spam on tab switches) + a popstate so
 * wouter's useSearch picks up the change. The default XP tab drops the param.
 */
function writeKnowledgeTabQuery(tab: KnowledgeTabId): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === "xp") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  // A shared section hash (#streak, #earn-vox) should not stick once the
  // user navigates tabs.
  const hash = url.hash.replace(/^#/, "");
  if (hash === "streak" || hash === "earn-vox") url.hash = "";
  window.history.replaceState({}, "", url.toString());
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * Compact "you are here" header for signed-in users: current rank, total XP,
 * and progress toward the next tier. Reads the live RANKS ladder so thresholds
 * stay in lockstep with the Ranks tab. Hidden for logged-out visitors, who see
 * the canonical intro card instead.
 */
function ProgressHeader() {
  const { isLoggedIn } = useAuth();
  const { data: stats } = useUserStats(isLoggedIn);
  const rank = stats?.rank;
  if (!isLoggedIn || !rank) return null;

  const xp = stats?.xpPoints ?? 0;
  const rankConfig = RANKS.find((r) => r.tier === rank.tier) ?? null;
  const nextRank = RANKS.find((r) => r.tier === rank.tier + 1) ?? null;
  const toNext = nextRank ? Math.max(0, nextRank.minXp - xp) : 0;
  const pct = nextRank
    ? Math.min(
        100,
        Math.max(
          0,
          ((xp - rank.minXp) / Math.max(1, nextRank.minXp - rank.minXp)) * 100,
        ),
      )
    : 100;

  return (
    <Card className="space-y-3 p-4" data-testid="how-it-works-progress">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {rankConfig ? (
            <RankIconChip rank={rankConfig} size="lg" />
          ) : (
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: rank.color }}
            >
              {rank.tier}
            </span>
          )}
          <div className="leading-tight">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Your rank
            </div>
            <div className="font-semibold">{rank.name}</div>
          </div>
        </div>
        <div className="text-right leading-tight">
          <div className="font-mono text-sm font-semibold">
            {xp.toLocaleString()} XP
          </div>
          <div className="text-[11px] text-muted-foreground">
            {nextRank
              ? `${toNext.toLocaleString()} XP to ${nextRank.name}`
              : "Top tier reached"}
          </div>
        </div>
      </div>
      {nextRank && (
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: rank.color }}
          />
        </div>
      )}
    </Card>
  );
}

export default function HowItWorksPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const welcomeModalRef = useRef<OnboardingDrawerHandle>(null);

  const [activeTab, setActiveTab] = useState<KnowledgeTabId>(() => {
    if (typeof window === "undefined") return "xp";
    // A #streak deep-link lands on the XP tab (the streak explainer lives there).
    if (window.location.hash.replace(/^#/, "") === "streak") return "xp";
    return parseKnowledgeTab(window.location.search);
  });

  // Keep state in lockstep with the URL so shared links and browser
  // back/forward resolve to the right tab.
  useEffect(() => {
    const fromUrl = parseKnowledgeTab(search);
    setActiveTab((prev) => (prev === fromUrl ? prev : fromUrl));
  }, [search]);

  const selectTab = useCallback((tab: KnowledgeTabId) => {
    writeKnowledgeTabQuery(tab);
    // Scroll the new section to the top of the viewport (just under the
    // sticky header) so a long previous tab doesn't leave the reader
    // mid-page. Skipped implicitly for #streak loads — that path runs
    // through useScrollToHash on mount, not this click handler.
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const tabsSection = document.getElementById("profile-tabs-section");
        const headerOffset = 56; // sticky header height (h-14)
        const top = tabsSection
          ? Math.max(0, tabsSection.getBoundingClientRect().top + window.scrollY - headerOffset)
          : 0;
        window.scrollTo({ top, behavior: "smooth" });
      });
    }
  }, []);

  useScrollToHash([activeTab]);

  const ActiveSection = SECTION_BY_TAB[activeTab];

  const tabIndex = useMemo(() => {
    const idx = KNOWLEDGE_NAV_TAB_ORDER.indexOf(activeTab);
    return idx >= 0 ? idx : 0;
  }, [activeTab]);

  const onSwipeLeft = useCallback(() => {
    if (tabIndex < KNOWLEDGE_NAV_TAB_ORDER.length - 1) {
      selectTab(KNOWLEDGE_NAV_TAB_ORDER[tabIndex + 1]!);
    }
  }, [selectTab, tabIndex]);

  const onSwipeRight = useCallback(() => {
    if (tabIndex > 0) {
      selectTab(KNOWLEDGE_NAV_TAB_ORDER[tabIndex - 1]!);
    }
  }, [selectTab, tabIndex]);

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
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg flex items-center justify-center pulse-icon-voxdex shrink-0">
              <BookOpen className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
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
        <div className="container mx-auto max-w-4xl px-2 py-2 sm:px-4">
          <KnowledgeTabsBar
            tabs={KNOWLEDGE_TABS}
            activeTab={activeTab}
            onTabChange={selectTab}
          />
        </div>
      </div>

      <SwipeNavigator
        onSwipeLeft={onSwipeLeft}
        onSwipeRight={onSwipeRight}
        disableLeft={tabIndex >= KNOWLEDGE_NAV_TAB_ORDER.length - 1}
        disableRight={tabIndex <= 0}
        ignoreSelector="[data-no-tab-swipe]"
        commitOffsetPx={96}
      >
        <div className="container mx-auto max-w-4xl space-y-6 px-2 py-6 sm:px-4">
          <ProgressHeader />

          <ActiveSection onJumpToTab={selectTab} />

          <Separator />

          <div className="space-y-3 text-center">
            <button
              type="button"
              onClick={() => welcomeModalRef.current?.open()}
              className="text-sm text-muted-foreground transition-colors hover:text-primary"
              data-testid="button-replay-how-it-works"
            >
              <HelpCircle className="mr-1 inline h-4 w-4 align-text-bottom" />
              How this page works
            </button>
            <p className="text-xs text-muted-foreground">
              Want to suggest a tweak to how rewards work?{" "}
              <a className="underline" href="/contact">
                Drop us a note
              </a>
              .
            </p>
          </div>
        </div>
      </SwipeNavigator>

      <HowItWorksWelcomeModal ref={welcomeModalRef} />
    </div>
  );
}
