/**
 * Weekly Wrap — Sunday recap of the user's prediction week.
 */

import * as React from "react";
import { Button, Heading, Section, Text } from "react-email";
import { voxWord } from "@shared/currency";
import { VoxAmount } from "../components/VoxAmount";
import type { FullWeeklyDigestStats } from "../../../jobs/weekly-digest-utils";
import { Layout } from "../components/Layout";
import { colors, fonts, radius, spacing, typography } from "../theme";

export const HERO_NEUTRAL_THRESHOLD = 0;

export interface WeeklyWrapEmailProps {
  stats: FullWeeklyDigestStats;
  baseUrl?: string;
  unsubscribeUrl?: string;
}

const DEFAULT_BASE_URL = "https://voxdex.com";

export function weeklyWrapSubject(
  stats: Pick<FullWeeklyDigestStats, "wins" | "losses">,
): string {
  const resolved = stats.wins + stats.losses;
  if (resolved <= 0) return "Your VoxDex week";
  const winsLabel = stats.wins === 1 ? "1 win" : `${stats.wins} wins`;
  const lossesLabel = stats.losses === 1 ? "1 loss" : `${stats.losses} losses`;
  return `Your VoxDex week: ${winsLabel}, ${lossesLabel}`;
}

/** Hero P&L uses word "Vox" — avoids Outlook tofu on the Ꝟ glyph.
 *  Best/worst pick amounts use VoxAmount (hosted PNG) for iOS Mail. */
export function formatHeroPnl(netCredits: number): string {
  const abs = Math.abs(netCredits);
  const word = voxWord(abs);
  if (netCredits > 0) return `+${word}`;
  if (netCredits < 0) return `\u2212${word}`;
  return word;
}

export function formatWinRatePercent(wins: number, losses: number): string {
  const total = wins + losses;
  if (total <= 0) return "0%";
  return `${Math.round((wins / total) * 100)}%`;
}

export function formatRankDeltaCopy(
  rankDelta: NonNullable<FullWeeklyDigestStats["rankDelta"]>,
): string {
  const { previous, current } = rankDelta;
  if (current < previous) {
    const n = previous - current;
    return `You moved up ${n} place${n === 1 ? "" : "s"} — now ranked #${current}.`;
  }
  if (current > previous) {
    const n = current - previous;
    return `You slipped ${n} place${n === 1 ? "" : "s"} — now ranked #${current}.`;
  }
  return `You held your ground at #${current}.`;
}

export function formatMoverLine(name: string, changePct: number): string {
  const sign = changePct >= 0 ? "+" : "";
  return `${name} ${sign}${changePct.toFixed(1)}%`;
}

export function WeeklyWrapEmail({
  stats,
  baseUrl = DEFAULT_BASE_URL,
  unsubscribeUrl,
}: WeeklyWrapEmailProps) {
  const {
    wins,
    losses,
    netCredits,
    bestPick,
    worstPick,
    rankDelta,
    jackpot,
    topWeeklyGainers,
  } = stats;

  const heroPnl = formatHeroPnl(netCredits);
  const heroColor =
    netCredits > HERO_NEUTRAL_THRESHOLD
      ? colors.success
      : netCredits < -HERO_NEUTRAL_THRESHOLD
        ? colors.danger
        : colors.textPrimary;
  const winRate = formatWinRatePercent(wins, losses);
  const resolved = wins + losses;
  const statLine = resolved > 0
    ? `${wins}W · ${losses}L · ${winRate} win rate`
    : null;

  const preview = `This week's recap on VoxDex. Your prediction week in one glance: results, best calls, and what to watch next on the trend index.`;

  return (
    <Layout
      preview={preview}
      footerContext="You're receiving this because you opted in to prediction emails on VoxDex."
      baseUrl={baseUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={{ ...typography.caption, margin: `0 0 ${spacing.snug}` }}>
        This week&apos;s recap
      </Text>

      <Heading
        style={{
          ...typography.h1,
          color: heroColor,
          margin: `0 0 ${spacing.snug}`,
        }}
      >
        {heroPnl}
      </Heading>

      {statLine ? (
        <Text style={statLineStyle}>{statLine}</Text>
      ) : null}

      {bestPick ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Your best call</Text>
          <Text style={typography.body}>
            You called {bestPick.label} — netted you{" "}
            <VoxAmount baseUrl={baseUrl} amount={bestPick.profit} variant="positive" />.
          </Text>
        </Section>
      ) : null}

      {worstPick ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Toughest call this week</Text>
          <Text style={typography.body}>
            {worstPick.label} closed against you{" "}
            <VoxAmount baseUrl={baseUrl} amount={worstPick.profit} variant="parens" />.
          </Text>
        </Section>
      ) : null}

      {rankDelta ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Leaderboard</Text>
          <Text style={typography.body}>{formatRankDeltaCopy(rankDelta)}</Text>
        </Section>
      ) : null}

      {jackpot ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Weekly Jackpot</Text>
          <Text style={typography.body}>
            {jackpot.won && jackpot.profit > 0
              ? `Your Jackpot ticket paid out +${voxWord(jackpot.profit)} this week.`
              : "Your Jackpot ticket didn't pay out this week. Better luck next week."}
          </Text>
        </Section>
      ) : null}

      {topWeeklyGainers.length > 0 ? (
        <Section style={blockStyle}>
          <Text style={blockHeadingStyle}>Watch this week</Text>
          {topWeeklyGainers.map((gainer) => (
            <Text key={gainer.name} style={{ ...typography.small, margin: `0 0 ${spacing.tight}` }}>
              {formatMoverLine(gainer.name, gainer.change7d)}
            </Text>
          ))}
        </Section>
      ) : null}

      <Section style={ctaContainerStyle}>
        <Button href={`${baseUrl}/predict`} style={ctaButtonStyle}>
          Predict this week&apos;s markets
        </Button>
      </Section>

      <Text style={{ ...typography.body, margin: 0 }}>See you inside,</Text>
      <Text style={{ ...typography.body, margin: 0 }}>— The VoxDex Team</Text>
    </Layout>
  );
}

export default WeeklyWrapEmail;

const statLineStyle: React.CSSProperties = {
  ...typography.body,
  color: colors.textSecondary,
  fontWeight: 600,
  letterSpacing: "0.04em",
  margin: `0 0 ${spacing.block}`,
};

const blockStyle: React.CSSProperties = {
  backgroundColor: colors.bgSubtle,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  margin: `${spacing.block} 0`,
  padding: `${spacing.block} ${spacing.paragraph}`,
};

const blockHeadingStyle: React.CSSProperties = {
  ...typography.caption,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  margin: `0 0 ${spacing.tight}`,
};

const ctaContainerStyle: React.CSSProperties = {
  margin: `${spacing.block} 0`,
  textAlign: "center",
};

const ctaButtonStyle: React.CSSProperties = {
  backgroundColor: colors.brand,
  borderRadius: radius.md,
  color: "#ffffff",
  display: "inline-block",
  fontFamily: fonts.body,
  fontSize: "16px",
  fontWeight: 600,
  padding: "14px 28px",
  textDecoration: "none",
};
