import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, BookOpen, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  KNOWLEDGE_TABS,
  XP_ACTIONS,
  RANKS,
  CAPABILITY_GATES,
  VOTE_SURFACES,
  PREDICT_SURFACES,
  PROPOSED_CREDIT_EARNS,
  PROPOSED_BADGES,
  type KnowledgeTab,
  type KnowledgeTabId,
  type XpActionRow,
} from "@/lib/gamification-content";

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
    | { label: string; value: string; variant: "xp-chrome" }
    | { label: string; value: string; accent: string; variant?: "default" },
) {
  if (props.variant === "xp-chrome") {
    const { label, value } = props;
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 dark:border-white/35 dark:bg-white/[0.06]">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-sm font-semibold text-slate-800 dark:text-white">
          {value}
        </span>
      </div>
    );
  }
  const { label, value, accent } = props;
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
      <span className="font-mono text-sm font-semibold" style={{ color: accent }}>
        {value}
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
                <code className="text-[11px] text-muted-foreground">
                  {row.actionKey}
                </code>
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

function XpSection() {
  const grouped = useMemo(() => {
    const order: XpActionRow["category"][] = [
      "Voting",
      "Content",
      "Engagement",
      "Prediction",
      "Streak",
      "Special",
    ];
    return order.map((category) => ({
      category,
      rows: XP_ACTIONS.filter((row) => row.category === category),
    }));
  }, []);

  const totalActions = XP_ACTIONS.length;
  const maxDaily = useMemo(() => {
    return XP_ACTIONS.reduce((sum, row) => {
      if (row.dailyCap === null || row.xpValue === 0) return sum;
      return sum + row.xpValue * row.dailyCap;
    }, 0);
  }, []);

  return (
    <section className="space-y-6">
      <SectionHeading
        id="xp"
        title="XP — Experience Points"
        subtitle="The headline progression metric. Earned from almost every meaningful interaction. Drives your rank."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatPill label="Tracked actions" value={String(totalActions)} variant="xp-chrome" />
        <StatPill
          label="Theoretical daily max"
          value={`${maxDaily.toLocaleString()} XP`}
          variant="xp-chrome"
        />
        <StatPill label="Highest single award" value="+100 XP (Win)" variant="xp-chrome" />
      </div>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">How XP is awarded</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            Every awardable event flows through one server-side function
            (<code className="text-foreground">awardXp</code>) which writes
            to an immutable <code className="text-foreground">xp_ledger</code>.
          </li>
          <li>
            Each award carries an idempotency key — the same vote, comment,
            or prediction can never grant XP twice, even on retry.
          </li>
          <li>
            Daily caps reset at the start of each calendar day (server time)
            per <em>(user, action)</em> pair. Once you hit the cap, further
            actions still count for product purposes — you just stop earning XP
            for them that day.
          </li>
          <li>
            Crossing a rank threshold automatically promotes your rank and
            sends a <code className="text-foreground">rank_up</code> notification.
          </li>
        </ul>
      </Card>

      {grouped.map(({ category, rows }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <XpActionTable rows={rows} />
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

function RanksSection() {
  const accent = accentFor("ranks");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="ranks"
        title="Ranks — Your VoxDex Reputation"
        subtitle="Eight tiers that unlock trust-gated capabilities and signal seniority across the leaderboard."
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
          Higher-trust actions are gated behind Aspirant (tier 2 / 500 XP) to
          keep the signal-to-noise ratio high during onboarding.
        </p>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Capability</th>
                <th className="px-3 py-2 font-medium">Min Tier</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITY_GATES.map((gate) => (
                <tr key={gate.capability} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <div className="font-medium">{gate.capability}</div>
                    <div className="text-xs text-muted-foreground">
                      {gate.description}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      style={{ borderColor: `${accent}66`, color: accent }}
                    >
                      Tier {gate.minTier}+
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Each rank carries a stored <code className="text-foreground">voteMultiplier</code>{" "}
          (1.0 → 3.0). It is not currently applied to vote weighting in code —
          treat the multipliers above as a roadmap rather than a live mechanic.
        </p>
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
        <StatPill label="Signup grant" value="1,000" accent={accent} />
        <StatPill label="Spend on" value="Predictions" accent={accent} />
        <StatPill label="Earn back via" value="Wins + Purchase" accent={accent} />
      </div>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Where Credits come from today</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Signup grant.</strong> New
            accounts start with a balance so you can place predictions
            immediately.
          </li>
          <li>
            <strong className="text-foreground">AMM payouts.</strong> Winning
            predictions return Credits to your balance via the market settler.
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
          Every prediction debits Credits from your balance and writes to the
          immutable <code className="text-foreground">credit_ledger</code>. Stake
          size is your call; the AMM determines the payout if you win.
        </p>
      </Card>

      <Card
        className="space-y-3 p-4"
        style={{
          borderColor: `${accent}66`,
          backgroundColor: `${accent}0F`,
        }}
      >
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            style={{ borderColor: `${accent}66`, color: accent }}
            className="text-[10px] uppercase tracking-wide"
          >
            Coming Soon
          </Badge>
          <h3 className="font-semibold">Earn Credits by participating</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          We're building out an engagement-based earn loop so active VoxMaxxers
          can sustain their balance without always reaching for the wallet.
          Credits will stay <em>much harder to earn than XP</em> — values below
          are placeholders pending tuning.
        </p>
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: `${accent}40` }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium text-right">Proposed Credits</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {PROPOSED_CREDIT_EARNS.map((row) => (
                <tr
                  key={row.action}
                  className="border-t border-border/60 align-top"
                >
                  <td className="px-3 py-2 font-medium">{row.action}</td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className="font-mono text-xs font-semibold"
                      style={{ color: accent }}
                    >
                      {row.proposedCredits}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 text-muted-foreground md:table-cell">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Approval-gated rows ship with anti-spam controls — you only earn once
          a moderator approves the suggestion.
        </p>
      </Card>
    </section>
  );
}

function BadgesSection() {
  const accent = accentFor("badges");
  const grouped = useMemo(() => {
    const order: ("Action" | "Milestone" | "Special / Event")[] = [
      "Action",
      "Milestone",
      "Special / Event",
    ];
    return order.map((category) => ({
      category,
      rows: PROPOSED_BADGES.filter((row) => row.category === category),
    }));
  }, []);

  const rarityAccent: Record<string, string> = {
    Common: "#94A3B8",
    Rare: "#3C83F6",
    Epic: "#8B5CF6",
    Legendary: "#F59E0B",
  };

  return (
    <section className="space-y-6">
      <SectionHeading
        id="badges"
        title="Badges — Achievements & Milestones"
        subtitle="A separate collection layer that recognises specific accomplishments — distinct from your tier-based Rank."
      />

      <Card
        className="flex items-start gap-3 p-4"
        style={{
          borderColor: `${accent}66`,
          backgroundColor: `${accent}0F`,
        }}
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accent }} />
        <div className="space-y-1 text-sm">
          <p className="font-medium" style={{ color: accent }}>
            Proposal — not yet implemented
          </p>
          <p className="text-muted-foreground">
            The taxonomy below is a working draft for the upcoming badges
            system. Ranks stay the headline reputation tier; badges sit
            alongside as a collectible record of <em>what</em> you've done.
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["Common", "Rare", "Epic", "Legendary"] as const).map((rarity) => (
          <Badge
            key={rarity}
            variant="outline"
            className="text-[11px]"
            style={{
              borderColor: `${rarityAccent[rarity]}66`,
              color: rarityAccent[rarity],
            }}
          >
            {rarity}
          </Badge>
        ))}
      </div>

      {grouped.map(({ category, rows }) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {category}
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((row) => (
              <Card key={row.name} className="space-y-1.5 p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{row.name}</div>
                  <Badge
                    variant="outline"
                    className="text-[10px]"
                    style={{
                      borderColor: `${rarityAccent[row.rarity]}66`,
                      color: rarityAccent[row.rarity],
                    }}
                  >
                    {row.rarity}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{row.trigger}</p>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function VoteSection() {
  const accent = accentFor("vote");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="vote"
        title="Vote — Shape the Conversation"
        subtitle="Voting is the most XP-rewarded surface on VoxDex. Every vote is recorded and contributes to leaderboard signal."
      />

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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">Suggesting new vote content</h3>
        <p className="text-sm text-muted-foreground">
          Submit matchups, sentiment polls, opinion polls, induction
          candidates, or profile images for admin review. You earn{" "}
          <span className="font-mono" style={{ color: accent }}>
            +5 XP
          </span>{" "}
          for the submission (capped at 3 / day) and a{" "}
          <span className="font-mono" style={{ color: accent }}>
            +50 XP
          </span>{" "}
          bonus when it's approved and goes live.
        </p>
        <p className="text-xs text-muted-foreground">
          Approval-gating is what protects against suggestion spam — only
          quality submissions earn the bonus, and Credits will follow the same
          rule once that earn path ships.
        </p>
      </Card>
    </section>
  );
}

function PredictSection() {
  const accent = accentFor("predict");
  return (
    <section className="space-y-6">
      <SectionHeading
        id="predict"
        title="Predict — Stake Your Take"
        subtitle="Spend Credits to predict outcomes. Win Credits + bonus XP when you're right."
      />

      <Card className="space-y-3 p-4">
        <h3 className="font-semibold">How prediction markets work</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            Every market is priced by an automated market maker (AMM). The
            price moves as people stake on either side.
          </li>
          <li>
            Your stake is debited from your Credits balance the moment you
            place the prediction.
          </li>
          <li>
            When the market resolves, the resolver settles winning positions —
            payout returns Credits to your balance and awards{" "}
            <span className="font-mono" style={{ color: accent }}>
              +100 XP
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
          World / open markets carry the most editorial weight on VoxDex. When
          your suggested world market is approved and published, you'll earn
          XP today and (once shipped) Credits as well.
        </p>
      </Card>
    </section>
  );
}

const SECTION_BY_TAB: Record<KnowledgeTabId, () => JSX.Element> = {
  xp: XpSection,
  ranks: RanksSection,
  credits: CreditsSection,
  badges: BadgesSection,
  vote: VoteSection,
  predict: PredictSection,
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

        <ActiveSection />

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
